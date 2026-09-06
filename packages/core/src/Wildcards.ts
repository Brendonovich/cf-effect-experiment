import { DataType } from "@macrograph/module/DataType";
import { Result } from "effect";

import type { Connection } from "./Connection.ts";
import type { NodeIO } from "./IO.ts";

import * as OutputRef from "./OutputRef.ts";

interface DataPort {
  readonly id: string;
  readonly type: DataType.Any;
}
interface ExecutionPort {
  readonly id: string;
  readonly scope?: ReadonlyArray<DataPort> | null | undefined;
}
export interface IO {
  readonly dataInputs: ReadonlyArray<DataPort>;
  readonly dataOutputs: ReadonlyArray<DataPort>;
  readonly executionInputs: ReadonlyArray<ExecutionPort>;
  readonly executionOutputs: ReadonlyArray<ExecutionPort>;
}

const declarationKey = (io: IO): string => {
  const data = ({ id, type }: DataPort) => ({ id, type });
  const execution = ({ id, scope }: ExecutionPort) => ({
    id,
    scope: scope == null ? scope : scope.map(data),
  });
  // Names, defaults and runtime suggestion callbacks do not constrain type variables.
  return JSON.stringify({
    dataInputs: io.dataInputs.map(data),
    dataOutputs: io.dataOutputs.map(data),
    executionInputs: io.executionInputs.map(execution),
    executionOutputs: io.executionOutputs.map(execution),
  });
};

/** Preserve port metadata while substituting types, without mutating declarations. */
export const mapIO = <T extends IO>(io: T, resolve: (type: DataType.Any) => DataType.Any): T => {
  const data = <P extends DataPort>(port: P): P => ({ ...port, type: resolve(port.type) });
  const execution = <P extends ExecutionPort>(port: P): P => ({
    ...port,
    ...(port.scope == null ? {} : { scope: port.scope.map(data) }),
  });
  return {
    ...io,
    dataInputs: io.dataInputs.map(data),
    dataOutputs: io.dataOutputs.map(data),
    executionInputs: io.executionInputs.map(execution),
    executionOutputs: io.executionOutputs.map(execution),
  };
};

interface Term {
  readonly node: string;
  readonly type: DataType.Any;
}
const key = (term: Term & { type: DataType.Wildcard }) => JSON.stringify([term.node, term.type.id]);
const child = (term: Term): Term | undefined =>
  term.type._tag === "List"
    ? { ...term, type: term.type.item }
    : term.type._tag === "Option"
      ? { ...term, type: term.type.inner }
      : undefined;

export interface Conflict {
  readonly nodes: ReadonlySet<string>;
  readonly connectionId: string;
  readonly reason: string;
}
export interface Group {
  readonly nodes: ReadonlySet<string>;
  readonly connections: ReadonlyArray<Connection.Model>;
  readonly resolve: (node: string, type: DataType.Any) => DataType.Any;
}

export interface DerivedOutputs {
  /** Changes when external definitions or the set of dynamic nodes changes. */
  readonly key: string;
  readonly outputs: (
    node: string,
    resolve: (type: DataType.Any) => DataType.Any,
  ) => Result.Result<NodeIO["dataOutputs"] | undefined, string>;
}

const solve = (
  nodes: ReadonlySet<string>,
  connections: ReadonlyArray<Connection.Model>,
  io: ReadonlyMap<string, IO>,
): Result.Result<Group, ReadonlyArray<Conflict>> => {
  const bindings = new Map<string, Term>();
  const bound: string[] = [];
  const conflicts: Conflict[] = [];
  const dereference = (term: Term): Term => {
    while (term.type._tag === "Wildcard") {
      const next = bindings.get(key({ ...term, type: term.type }));
      if (next === undefined) break;
      term = next;
    }
    return term;
  };
  const occurs = (id: string, term: Term): boolean => {
    term = dereference(term);
    if (term.type._tag === "Wildcard") return key({ ...term, type: term.type }) === id;
    const inner = child(term);
    return inner !== undefined && occurs(id, inner);
  };
  const unify = (a: Term, b: Term): boolean => {
    a = dereference(a);
    b = dereference(b);
    if (a.type._tag === "Wildcard") {
      const id = key({ ...a, type: a.type });
      if (b.type._tag === "Wildcard" && key({ ...b, type: b.type }) === id) return true;
      if (occurs(id, b)) return false;
      bindings.set(id, b);
      bound.push(id);
      return true;
    }
    if (b.type._tag === "Wildcard") return unify(b, a);
    if (a.type._tag !== b.type._tag) return false;
    const ac = child(a),
      bc = child(b);
    return ac !== undefined && bc !== undefined ? unify(ac, bc) : DataType.equals(a.type, b.type);
  };
  for (const wire of connections) {
    if (!nodes.has(wire.outNodeId)) continue;
    const source = io.get(wire.outNodeId),
      target = io.get(wire.inNodeId);
    if (source === undefined || target === undefined) continue;
    const output = OutputRef.resolve(source, wire.outIo);
    const bindingCount = bound.length;
    const conflictCount = conflicts.length;
    const inputs = target.dataInputs.filter((port) => port.id === wire.inIoId);
    const pair = (a: DataPort, b: DataPort) => {
      // Ordinary concrete incompatibilities are handled by endpoint validation.
      if (!DataType.hasWildcard(a.type) && !DataType.hasWildcard(b.type)) return;
      if (!unify({ node: wire.outNodeId, type: a.type }, { node: wire.inNodeId, type: b.type }))
        conflicts.push({
          nodes,
          connectionId: wire.id,
          reason: "Conflicting or recursive wildcard types",
        });
    };
    if (output?.kind === "data" && inputs.length === 1) pair(output.port, inputs[0]!);
    if (output?.kind === "execution" && output.port.scope != null) {
      const input = target.executionInputs.find((port) => port.id === wire.inIoId);
      // An inferred scope input exposes its fields as data outputs (Break Scope).
      const fields = input?.scope === null ? target.dataOutputs : input?.scope;
      for (const field of fields ?? []) {
        const source = output.port.scope.find((candidate) => candidate.id === field.id);
        if (source !== undefined) pair(source, field);
      }
    }
    if (conflicts.length !== conflictCount) {
      while (bound.length > bindingCount) bindings.delete(bound.pop()!);
    }
  }
  if (conflicts.length > 0) return Result.fail(conflicts);
  const values = new Map<string, DataType.Any>();
  const resolve = (node: string, type: DataType.Any): DataType.Any => {
    const id = type._tag === "Wildcard" ? key({ node, type }) : undefined;
    const cached = id === undefined ? undefined : values.get(id);
    if (cached !== undefined) return cached;
    const term = dereference({ node, type });
    const value =
      term.type._tag === "List"
        ? DataType.List(resolve(term.node, term.type.item))
        : term.type._tag === "Option"
          ? DataType.Option(resolve(term.node, term.type.inner))
          : term.type;
    if (id !== undefined) values.set(id, value);
    return value;
  };
  return Result.succeed({ nodes, connections, resolve });
};

/**
 * Explicit, non-reactive connected-component cache. Nodes conservatively group all their
 * pins; each node-local wildcard still has a separate unification variable. Updates diff
 * declarations/wires, invalidate their OLD groups, then crawl the NEW adjacency to handle
 * merges, splits, removed anchors, cycles, and deleted nodes. Unaffected groups are reused.
 */
export class Cache {
  private declarations = new Map<string, string>();
  private wires = new Map<string, Connection.Model>();
  // Include non-data wires too: an IO change can turn an exec port into a data port.
  private incident = new Map<string, ReadonlyMap<string, Connection.Model>>();
  private byNode = new Map<string, Group>();
  private outputDeclarations = new Map<string, NodeIO["dataOutputs"]>();
  private sourceKey: string | undefined;

  derivedOutputs(node: string): NodeIO["dataOutputs"] | undefined {
    return this.outputDeclarations.get(node);
  }

  get groups(): ReadonlySet<Group> {
    return new Set(this.byNode.values());
  }
  group(node: string): Group | undefined {
    return this.byNode.get(node);
  }
  resolve(node: string, type: DataType.Any): DataType.Any {
    return this.byNode.get(node)?.resolve(node, type) ?? type;
  }
  resolveIO<T extends IO>(node: string, io: T): T {
    return mapIO(io, (type) => this.resolve(node, type));
  }

  /** Validate a candidate graph, committing all indexes/groups only if it is valid. */
  update(
    io: ReadonlyMap<string, IO>,
    connections: ReadonlyArray<Connection.Model>,
    derive?: DerivedOutputs,
  ): Result.Result<void, ReadonlyArray<Conflict>> {
    if (derive === undefined) {
      const result = this.updateOnce(io, connections);
      if (Result.isSuccess(result)) {
        this.outputDeclarations = new Map();
        this.sourceKey = undefined;
      }
      return result;
    }
    // Start from declarations without last snapshot's inferred fields. Otherwise a
    // disconnected Break chain could keep itself anchored through its stale outputs.
    let declarations = new Map(io);
    for (const [id, ports] of io) {
      const output = derive.outputs(id, (type) => type);
      if (Result.isSuccess(output) && output.success !== undefined)
        declarations.set(id, { ...ports, dataOutputs: output.success });
    }
    const sourceKey = JSON.stringify([
      derive.key,
      [...declarations].map(([id, ports]) => [id, declarationKey(ports)]),
      connections,
    ]);
    if (this.sourceKey === sourceKey) return Result.succeed(undefined);
    const staged = new Cache();
    staged.declarations = this.declarations;
    staged.wires = this.wires;
    staged.incident = new Map(this.incident);
    staged.byNode = new Map(this.byNode);
    for (let round = 0; round <= io.size; round++) {
      const result = staged.updateOnce(declarations, connections);
      if (Result.isFailure(result)) return result;
      const next = new Map(declarations);
      const outputs = new Map<string, NodeIO["dataOutputs"]>();
      const conflicts: Conflict[] = [];
      let changed = false;
      for (const [id, ports] of declarations) {
        const output = derive.outputs(id, (type) => staged.resolve(id, type));
        if (Result.isFailure(output)) {
          conflicts.push({
            nodes: staged.group(id)?.nodes ?? new Set([id]),
            connectionId: connections.find((wire) => wire.inNodeId === id)?.id ?? "",
            reason: output.failure,
          });
        } else if (output.success !== undefined) {
          outputs.set(id, output.success);
          if (JSON.stringify(ports.dataOutputs) !== JSON.stringify(output.success)) {
            changed = true;
            next.set(id, { ...ports, dataOutputs: output.success });
          }
        }
      }
      if (conflicts.length > 0) return Result.fail(conflicts);
      if (!changed) {
        this.declarations = staged.declarations;
        this.wires = staged.wires;
        this.incident = staged.incident;
        this.byNode = staged.byNode;
        this.outputDeclarations = outputs;
        this.sourceKey = sourceKey;
        return Result.succeed(undefined);
      }
      declarations = next;
    }
    return Result.fail([
      {
        nodes: new Set(io.keys()),
        connectionId: "",
        reason: "Inferred output types did not stabilize",
      },
    ]);
  }

  private updateOnce(
    io: ReadonlyMap<string, IO>,
    connections: ReadonlyArray<Connection.Model>,
  ): Result.Result<void, ReadonlyArray<Conflict>> {
    const dirty = new Set<string>();
    const declarations = new Map(Array.from(io, ([id, ports]) => [id, declarationKey(ports)]));
    for (const id of new Set([...this.declarations.keys(), ...declarations.keys()]))
      if (this.declarations.get(id) !== declarations.get(id)) dirty.add(id);
    const wires = new Map<string, Connection.Model>(connections.map((wire) => [wire.id, wire]));
    // Copy-on-write buckets: a rejected attempt cannot change the live adjacency index.
    const changedIncident = new Map<string, Map<string, Connection.Model>>();
    const editIncident = (node: string) => {
      let bucket = changedIncident.get(node);
      if (bucket === undefined) {
        bucket = new Map(this.incident.get(node));
        changedIncident.set(node, bucket);
      }
      return bucket;
    };
    for (const id of new Set([...this.wires.keys(), ...wires.keys()])) {
      const before = this.wires.get(id),
        after = wires.get(id);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      if (before !== undefined) {
        editIncident(before.outNodeId).delete(id);
        editIncident(before.inNodeId).delete(id);
      }
      if (after !== undefined) {
        editIncident(after.outNodeId).set(id, after);
        editIncident(after.inNodeId).set(id, after);
      }
      for (const wire of [before, after])
        if (wire !== undefined) {
          dirty.add(wire.outNodeId);
          dirty.add(wire.inNodeId);
        }
    }
    if (dirty.size === 0) return Result.succeed(undefined);
    const affected = new Set<Group>();
    for (const id of dirty) {
      const group = this.byNode.get(id);
      if (group !== undefined) affected.add(group);
    }
    for (const group of affected) for (const member of group.nodes) dirty.add(member);
    const completed: Group[] = [];
    const conflicts: Conflict[] = [];
    const visited = new Set<string>();
    const order = new Map(connections.map((wire, index) => [wire.id, index]));
    for (const id of dirty) {
      if (!io.has(id) || visited.has(id)) continue;
      const members = new Set<string>(),
        pending = [id];
      const direct = new Map<string, Connection.Model>();
      while (pending.length > 0) {
        const node = pending.pop()!;
        if (members.has(node)) continue;
        members.add(node);
        visited.add(node);
        for (const wire of (changedIncident.get(node) ?? this.incident.get(node))?.values() ?? []) {
          if (!io.has(wire.outNodeId) || !io.has(wire.inNodeId)) continue;
          const output = OutputRef.resolve(io.get(wire.outNodeId)!, wire.outIo);
          // Plain control flow does not couple type variables.
          if (output === undefined || (output.kind === "execution" && output.port.scope == null))
            continue;
          direct.set(wire.id, wire);
          pending.push(wire.outNodeId === node ? wire.inNodeId : wire.outNodeId);
        }
      }
      // Preserve wire order so invalid saved graphs report deterministic conflicts.
      const groupWires = [...direct.values()].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      const group = solve(members, groupWires, io);
      if (Result.isFailure(group)) conflicts.push(...group.failure);
      else completed.push(group.success);
    }
    if (conflicts.length > 0) return Result.fail(conflicts);
    for (const id of dirty) this.byNode.delete(id);
    for (const group of completed) for (const node of group.nodes) this.byNode.set(node, group);
    for (const [node, bucket] of changedIncident) {
      if (bucket.size === 0) this.incident.delete(node);
      else this.incident.set(node, bucket);
    }
    this.declarations = declarations;
    this.wires = wires;
    return Result.succeed(undefined);
  }
}

export * as Wildcards from "./Wildcards.ts";
