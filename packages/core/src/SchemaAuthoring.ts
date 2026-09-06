import { DataType } from "@macrograph/module/DataType";
import { Result } from "effect";

import type { Graph } from "./Graph.ts";
import type { Node } from "./Node.ts";
import type { Package } from "./Package.ts";

import { IoId, type NodeIO } from "./IO.ts";
import * as OutputRef from "./OutputRef.ts";
import * as Wildcards from "./Wildcards.ts";

export interface Context {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly definitions: DataType.Definitions;
}

export interface PropertySource {
  readonly placeholder: string;
  readonly unavailableLabel: string;
  readonly ariaLabel?: string;
  readonly options: (
    context: Context,
  ) => ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export interface IOContext extends Context {
  /** Server-provided base IO. Generators must replace any snapshot-derived dynamic portions. */
  readonly declared: NodeIO;
  readonly resolve: (type: DataType.Any) => DataType.Any;
  readonly inputScope: (input: string) => NodeIO["dataOutputs"] | undefined;
}

/** Pure, browser-safe schema behavior. Execution/engine implementations stay server-side. */
export interface Definition {
  readonly properties?: Readonly<Record<string, PropertySource>>;
  readonly generateIO?: (context: IOContext) => Result.Result<NodeIO, string>;
  readonly acceptsInput?: (
    input: string,
    type: DataType.Any,
    definitions: DataType.Definitions | undefined,
  ) => boolean;
}

export interface PackageDefinition {
  readonly model: Package.Model;
  readonly schemas: Readonly<Record<string, Definition>>;
}

/** Explicit registration, not global mutable state. Hosts can install additional authoring packages. */
export class Registry {
  constructor(readonly packages: ReadonlyArray<PackageDefinition> = []) {}

  get(ref: { readonly package: string; readonly schema: string }): Definition | undefined {
    const schemas = this.packages.findLast((pkg) => pkg.model.id === ref.package)?.schemas;
    return schemas !== undefined && Object.hasOwn(schemas, ref.schema)
      ? schemas[ref.schema]
      : undefined;
  }

  with(...packages: ReadonlyArray<PackageDefinition>): Registry {
    return new Registry([...this.packages, ...packages]);
  }

  /** Catalog metadata is static; project definitions are supplied to callbacks at evaluation time. */
  catalog(received: ReadonlyArray<Package.Model>): Package.Model[] {
    return [
      ...new Map(
        [...this.packages.map((pkg) => pkg.model), ...received].map((pkg) => [pkg.id, pkg]),
      ).values(),
    ];
  }
}

export const inputScope =
  (graph: Graph.Model, nodeId: string, ioForNode: (id: string) => NodeIO | undefined) =>
  (input: string): NodeIO["dataOutputs"] | undefined => {
    const wires = graph.connections.filter(
      (wire) => wire.inNodeId === nodeId && wire.inIoId === input,
    );
    if (wires.length !== 1) return;
    const wire = wires[0]!;
    const source = ioForNode(wire.outNodeId);
    if (source === undefined) return;
    const output = OutputRef.resolve(source, wire.outIo);
    return output?.kind === "execution"
      ? output.port.scope?.map((field) => ({ ...field, id: IoId.make(field.id) }))
      : undefined;
  };

export interface Resolution {
  readonly io: Readonly<Record<string, NodeIO>>;
  readonly diagnostics: Readonly<Record<string, ReadonlyArray<string>>>;
}

/** Solves declarations and schema-owned IO together, clearing stale inferred pins before each solve. */
export class GraphResolver {
  private key: string | undefined;
  private value: Resolution | undefined;

  constructor(readonly registry: Registry) {}

  resolve(
    graph: Graph.Model,
    declared: Readonly<Record<string, NodeIO>>,
    definitions: DataType.Definitions,
  ): Resolution {
    const key = JSON.stringify([
      Object.values(graph.nodes).map((node) => [node.id, node.schema, node.properties]),
      graph.connections,
      declared,
      definitions,
    ]);
    if (this.key === key && this.value !== undefined) return this.value;
    const diagnostics: Record<string, string[]> = {};
    const generate = (node: Node.Model, context: IOContext, fallback: NodeIO): NodeIO => {
      delete diagnostics[node.id];
      const behavior = this.registry.get(node.schema);
      const result = behavior?.generateIO?.(context);
      const io =
        result === undefined
          ? context.declared
          : Result.isSuccess(result)
            ? result.success
            : undefined;
      if (io !== undefined) {
        const rejected = io.dataInputs.find(
          (input) =>
            behavior?.acceptsInput?.(input.id, context.resolve(input.type), definitions) === false,
        );
        if (rejected === undefined) return io;
        diagnostics[node.id] = [
          `Input ${rejected.name ?? rejected.id} does not accept the inferred type`,
        ];
      } else if (result !== undefined && Result.isFailure(result))
        diagnostics[node.id] = [result.failure];
      // A failed generator must not expose stale, previously inferred ports.
      return fallback;
    };
    const initial: Record<string, NodeIO> = { ...declared };
    for (const node of Object.values(graph.nodes)) {
      const io = declared[node.id];
      if (io === undefined) continue;
      initial[node.id] = generate(
        node,
        {
          declared: io,
          properties: node.properties,
          definitions,
          resolve: (type) => type,
          inputScope: () => undefined,
        },
        { dataInputs: [], dataOutputs: [], executionInputs: [], executionOutputs: [] },
      );
    }
    let current = initial;
    const cache = new Wildcards.Cache();
    for (let round = 0; round <= Object.keys(graph.nodes).length + 1; round++) {
      const solved = cache.update(new Map(Object.entries(current)), graph.connections);
      const invalid = new Set<string>();
      if (Result.isFailure(solved)) {
        for (const conflict of solved.failure)
          for (const id of conflict.nodes) {
            invalid.add(id);
            diagnostics[id] = [...new Set([...(diagnostics[id] ?? []), conflict.reason])];
          }
        // Invalid components must not hide inferred pins in unrelated components.
        cache.update(
          new Map(Object.entries(current).filter(([id]) => !invalid.has(id))),
          graph.connections.filter(
            (wire) => !invalid.has(wire.outNodeId) && !invalid.has(wire.inNodeId),
          ),
        );
      }
      const next: Record<string, NodeIO> = { ...declared };
      for (const node of Object.values(graph.nodes)) {
        const io = declared[node.id];
        if (io === undefined) continue;
        if (invalid.has(node.id)) {
          next[node.id] = initial[node.id]!;
          continue;
        }
        next[node.id] = generate(
          node,
          {
            declared: io,
            properties: node.properties,
            definitions,
            resolve: (type) => cache.resolve(node.id, type),
            inputScope: inputScope(graph, node.id, (id) => {
              const io = current[id];
              return io === undefined ? undefined : cache.resolveIO(id, io);
            }),
          },
          initial[node.id]!,
        );
      }
      if (JSON.stringify(current) === JSON.stringify(next)) {
        current = Object.fromEntries(
          Object.entries(next).map(([id, io]) => [id, cache.resolveIO(id, io)]),
        );
        break;
      }
      current = next;
      if (round === Object.keys(graph.nodes).length + 1) {
        current = initial;
        for (const id of Object.keys(current)) diagnostics[id] = ["Inferred IO did not stabilize"];
      }
    }
    this.key = key;
    this.value = { io: current, diagnostics };
    return this.value;
  }
}

export * as SchemaAuthoring from "./SchemaAuthoring.ts";
