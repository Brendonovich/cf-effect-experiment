import {
  CustomTypes,
  Graph,
  Node,
  OutputRef,
  Project,
  ResourceConstant,
  Scopes,
  TypeDefinition,
  Wildcards,
} from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import * as Engine from "@macrograph/module/Engine";
import * as Module from "@macrograph/module/Module";
import * as Registration from "@macrograph/module/Registration";
import { Cause, Effect, Ref, Result, Schema } from "effect";

const NodeOutputKey = Schema.String.pipe(Schema.brand("NodeOutputKey"));
type NodeOutputKey = typeof NodeOutputKey.Type;

export class ModuleNotRegistered extends Schema.TaggedError<ModuleNotRegistered>()(
  "ModuleNotRegistered",
  { moduleId: Schema.String },
) {}

export class SchemaNotRegistered extends Schema.TaggedError<SchemaNotRegistered>()(
  "SchemaNotRegistered",
  { moduleId: Schema.String, schemaId: Schema.String },
) {}

export class InvalidConnection extends Schema.TaggedError<InvalidConnection>()(
  "InvalidConnection",
  { connectionId: Schema.String, reason: Schema.String },
) {}

export class MissingInput extends Schema.TaggedError<MissingInput>()("MissingInput", {
  nodeId: Schema.String,
  inputId: Schema.String,
}) {}

export class MissingOutput extends Schema.TaggedError<MissingOutput>()("MissingOutput", {
  nodeId: Schema.String,
  outputId: Schema.String,
}) {}

export class ScopeNotActive extends Schema.TaggedError<ScopeNotActive>()("ScopeNotActive", {
  nodeId: Schema.String,
  scopeId: Schema.String,
}) {}
type ScopeActivations = ReadonlyMap<
  string,
  { readonly scopeId: string; readonly payload: Readonly<Record<string, unknown>> } | undefined
>;

export class InvalidInputValue extends Schema.TaggedError<InvalidInputValue>()(
  "InvalidInputValue",
  { nodeId: Schema.String, inputId: Schema.String, reason: Schema.String },
) {}

export class InvalidOutputValue extends Schema.TaggedError<InvalidOutputValue>()(
  "InvalidOutputValue",
  { nodeId: Schema.String, outputId: Schema.String, reason: Schema.String },
) {}

export class ExecutionCycle extends Schema.TaggedError<ExecutionCycle>()("ExecutionCycle", {
  nodeId: Schema.String,
}) {}

export class ResourceResolutionError extends Schema.TaggedError<ResourceResolutionError>()(
  "ResourceResolutionError",
  { nodeId: Schema.String, property: Schema.String, reason: Schema.String },
) {}

export class EngineClientUnavailable extends Schema.TaggedError<EngineClientUnavailable>()(
  "EngineClientUnavailable",
  { moduleId: Schema.String },
) {}

export class NodeExecutionError extends Schema.TaggedError<NodeExecutionError>()(
  "NodeExecutionError",
  { nodeId: Schema.String, cause: Schema.Unknown },
) {}

export class InvalidGraph extends Schema.TaggedError<InvalidGraph>()("InvalidGraph", {
  graphId: Schema.String,
  nodeId: Schema.String,
  reasons: Schema.Array(Schema.String),
}) {}

const isEngineClientUnavailable = (value: unknown): value is EngineClientUnavailable =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "EngineClientUnavailable";

export type ExecutorError =
  | ModuleNotRegistered
  | SchemaNotRegistered
  | InvalidConnection
  | MissingInput
  | MissingOutput
  | ScopeNotActive
  | InvalidInputValue
  | InvalidOutputValue
  | ExecutionCycle
  | ResourceResolutionError
  | EngineClientUnavailable
  | NodeExecutionError
  | InvalidGraph
  | Node.NotFoundError;

interface RegisteredModule {
  readonly schemas: ReadonlyMap<string, Registration.RegisteredSchema>;
  readonly engineClient: unknown;
}

interface ExecutionState {
  readonly outputs: Map<NodeOutputKey, unknown>;
  readonly nodeIO: Map<string, Registration.RegisteredNodeIO>;
  readonly completedPureNodes: Set<string>;
  readonly runningPureNodes: Set<string>;
}

export interface Service {
  readonly project: Effect.Effect<Project.Model>;
  readonly loadProject: (project: Project.Model) => Effect.Effect<void>;
  readonly module: <Definition extends Engine.AnyDef = never>(
    ...args: Module.RegisterArgs<Definition>
  ) => Effect.Effect<void>;
  readonly handleEvent: <Definition extends Engine.AnyDef>(
    module: Module.Module<Definition>,
    event: Engine.EventOf<Definition>,
  ) => Effect.Effect<void, ExecutorError>;
}

export interface NodeExecutionKey {
  readonly projectId: string;
  readonly graphId: string;
  readonly eventNodeId: string;
  readonly nodeId: string;
  readonly kind: "base" | "event" | "exec";
  readonly executionPath: string;
  readonly executionTraceId: string;
  readonly traceId: string;
  readonly parentTraceId?: string;
}

export interface NodeOutput {
  readonly outputId: string;
  readonly value: unknown;
}

export interface NodeExecutionResult {
  readonly outputs: ReadonlyArray<NodeOutput>;
  readonly executionOutputId: string | null;
  readonly scopePayload?: Readonly<Record<string, unknown>>;
}

export interface ExecutionDriver {
  readonly executeNode: (
    key: NodeExecutionKey,
    effect: Effect.Effect<NodeExecutionResult, ExecutorError>,
  ) => Effect.Effect<NodeExecutionResult, ExecutorError>;
}

export interface MakeOptions {
  readonly projectId?: string;
  readonly executionDriver?: ExecutionDriver;
  readonly engineClient?: (moduleId: string) => Effect.Effect<unknown>;
  readonly resourceValues?: (
    resource: ResourceConstant.ResourceRef,
  ) => Effect.Effect<ReadonlyArray<ResourceConstant.LiveValue>>;
}

export const inlineExecutionDriver: ExecutionDriver = {
  executeNode: (_key, effect) => effect,
};

const outputKey = (nodeId: string, outputId: string) =>
  NodeOutputKey.make(`${nodeId}\0${outputId}`);

export const make = Effect.fnUntraced(function* (
  initialProject: Project.Model,
  options?: MakeOptions,
): Effect.fn.Return<Service> {
  const project = yield* Ref.make(initialProject);
  const modules = yield* Ref.make<ReadonlyMap<string, RegisteredModule>>(new Map());
  const executionDriver = options?.executionDriver ?? inlineExecutionDriver;
  const projectId = options?.projectId ?? "local";

  const registerModule: Service["module"] = Effect.fnUntraced(function* (...args) {
    const [definition, deployment] = args;
    if (
      definition.engine !== undefined &&
      (deployment === undefined ||
        deployment.moduleId !== definition.id ||
        deployment.definition !== definition.engine)
    )
      return yield* Effect.die(`Deployment does not match module ${definition.id}`);
    const registered = yield* Registration.collect(definition.effect);
    const engineClient =
      definition.engine === undefined
        ? undefined
        : options?.engineClient === undefined
          ? new Proxy(
              {},
              {
                get: () => () =>
                  Effect.fail(new EngineClientUnavailable({ moduleId: definition.id })),
              },
            )
          : yield* options.engineClient(definition.id);
    yield* Ref.update(modules, (current) => {
      const next = new Map(current);
      next.set(definition.id, {
        schemas: new Map(registered.map((schema) => [schema.id, schema])),
        engineClient,
      });
      return next;
    });
  });

  const getSchema = Effect.fnUntraced(function* (
    registeredModules: ReadonlyMap<string, RegisteredModule>,
    node: Node.Model,
  ) {
    const registeredModule = registeredModules.get(node.schema.package);
    if (registeredModule === undefined)
      return yield* new ModuleNotRegistered({ moduleId: node.schema.package });
    const schema = registeredModule.schemas.get(node.schema.schema);
    if (schema === undefined)
      return yield* new SchemaNotRegistered({
        moduleId: node.schema.package,
        schemaId: node.schema.schema,
      });
    return schema;
  });

  const handleEvent: Service["handleEvent"] = Effect.fnUntraced(function* (definition, event) {
    const currentProject = yield* Ref.get(project);
    const registeredModules = new Map(yield* Ref.get(modules));
    registeredModules.set(CustomTypes.packageId, {
      schemas: CustomTypes.schemas(currentProject.types),
      engineClient: undefined,
    });
    registeredModules.set(Scopes.packageId, {
      schemas: new Map([[Scopes.schema.id, Scopes.schema]]),
      engineClient: undefined,
    });
    if (!registeredModules.has(definition.id))
      return yield* new ModuleNotRegistered({ moduleId: definition.id });

    const resolveProperties = Effect.fnUntraced(function* (
      node: Node.Model,
      schema: Registration.RegisteredSchema,
      lookupLiveValues = true,
    ): Effect.fn.Return<Readonly<Record<string, unknown>>, ExecutorError> {
      const resolved: Record<string, unknown> = { ...node.properties };
      for (const property of schema.properties) {
        if (!("resource" in property)) continue;
        const constantId = node.properties[property.id];
        if (typeof constantId !== "string")
          return yield* new ResourceResolutionError({
            nodeId: node.id,
            property: property.id,
            reason: "Property is not bound to a resource constant",
          });
        const constant = currentProject.constants[constantId];
        if (constant === undefined)
          return yield* new ResourceResolutionError({
            nodeId: node.id,
            property: property.id,
            reason: `Resource constant ${constantId} does not exist`,
          });
        if (
          constant.resource.package !== node.schema.package ||
          constant.resource.resource !== property.resource
        )
          return yield* new ResourceResolutionError({
            nodeId: node.id,
            property: property.id,
            reason: "Resource constant has an incompatible resource type",
          });
        if (constant.value === undefined)
          return yield* new ResourceResolutionError({
            nodeId: node.id,
            property: property.id,
            reason: "Resource constant has no selected value",
          });
        if (!lookupLiveValues || options?.resourceValues === undefined) {
          resolved[property.id] = constant.value;
        } else {
          const values = yield* options.resourceValues(constant.resource).pipe(
            Effect.catchCause(() =>
              Effect.fail(
                new ResourceResolutionError({
                  nodeId: node.id,
                  property: property.id,
                  reason: "Resource values could not be loaded",
                }),
              ),
            ),
          );
          const selected = values.find(
            (candidate) => JSON.stringify(candidate.id) === JSON.stringify(constant.value),
          );
          if (selected === undefined)
            return yield* new ResourceResolutionError({
              nodeId: node.id,
              property: property.id,
              reason: "Selected resource value is no longer available",
            });
          resolved[property.id] = selected.id;
        }
      }
      return resolved;
    });

    const generateUnresolvedNodeIO = Effect.fnUntraced(function* (
      graph: Graph.Model,
      node: Node.Model,
      schema: Registration.RegisteredSchema,
      properties: Readonly<Record<string, unknown>>,
    ): Effect.fn.Return<Registration.RegisteredNodeIO, ExecutorError> {
      const generate = (
        schema: Registration.RegisteredSchema,
        properties: Readonly<Record<string, unknown>>,
      ) =>
        Effect.try({
          try: () => schema.generateIO(properties),
          catch: () =>
            new InvalidGraph({
              graphId: graph.id,
              nodeId: node.id,
              reasons: ["Schema IO could not be generated"],
            }),
        });
      const io = yield* generate(schema, properties);
      if (!Scopes.isBreakScope(node)) return io;
      const wires = graph.connections.filter(
        (wire) => wire.inNodeId === node.id && wire.inIoId === "scope",
      );
      const wire = wires.length === 1 ? wires[0] : undefined;
      if (wire === undefined) return io;
      const source = yield* Graph.getNode(graph, wire.outNodeId);
      const sourceSchema = yield* getSchema(registeredModules, source);
      const sourceIO = yield* generate(
        sourceSchema,
        yield* resolveProperties(source, sourceSchema, false),
      );
      const fields =
        wire.outIo._tag === "Port"
          ? sourceIO.executionOutputs.find((port) => port.id === OutputRef.parentId(wire.outIo))
              ?.scope
          : undefined;
      return {
        ...io,
        dataOutputs: (fields ?? []).map(
          (field) => new Registration.DataOutputRef(field.id, field.type, field.name),
        ),
      };
    });

    // Event-local declarations are immutable. Reuse the solved groups for preflight,
    // live input/output checks and durable-result encoding/decoding alike.
    const wildcardGraphs = new Map<string, Wildcards.Cache>();
    const generateNodeIO = Effect.fnUntraced(function* (
      graph: Graph.Model,
      node: Node.Model,
      schema: Registration.RegisteredSchema,
      properties: Readonly<Record<string, unknown>>,
    ): Effect.fn.Return<Registration.RegisteredNodeIO, ExecutorError> {
      const io = yield* generateUnresolvedNodeIO(graph, node, schema, properties);
      let cache = wildcardGraphs.get(graph.id);
      if (cache?.group(node.id) === undefined) {
        cache ??= new Wildcards.Cache();
        const declarations = new Map<string, Registration.RegisteredNodeIO>();
        for (const candidate of Object.values(graph.nodes)) {
          const declaration =
            candidate.id === node.id
              ? io
              : yield* Effect.gen(function* () {
                  const schema = yield* getSchema(registeredModules, candidate);
                  return yield* generateUnresolvedNodeIO(
                    graph,
                    candidate,
                    schema,
                    yield* resolveProperties(candidate, schema, false),
                  );
                }).pipe(Effect.catchCause(() => Effect.succeed(undefined)));
          // Unavailable nodes outside the event closure must not block execution.
          // The ordinary preflight still reports them if it reaches them.
          if (declaration !== undefined) declarations.set(candidate.id, declaration);
        }
        const derive = CustomTypes.derivedOutputs(graph, currentProject.types);
        const result = cache.update(declarations, graph.connections, derive);
        if (Result.isFailure(result)) {
          const conflicts = result.failure.filter((conflict) => conflict.nodes.has(node.id));
          if (conflicts.length > 0)
            return yield* new InvalidGraph({
              graphId: graph.id,
              nodeId: node.id,
              reasons: conflicts.map((conflict) => `${conflict.connectionId}: ${conflict.reason}`),
            });
          // Keep only completed groups outside invalid components. If execution reaches
          // an excluded node later, validate it again above rather than caching its errors.
          const invalidNodes = new Set(result.failure.flatMap((conflict) => [...conflict.nodes]));
          const valid = cache.update(
            new Map([...declarations].filter(([id]) => !invalidNodes.has(id))),
            graph.connections.filter(
              (wire) => !invalidNodes.has(wire.outNodeId) && !invalidNodes.has(wire.inNodeId),
            ),
            derive,
          );
          if (Result.isFailure(valid))
            return yield* new InvalidGraph({
              graphId: graph.id,
              nodeId: node.id,
              reasons: valid.failure.map((conflict) => conflict.reason),
            });
        }
        wildcardGraphs.set(graph.id, cache);
      }
      const outputs = cache.derivedOutputs(node.id);
      return cache.resolveIO(
        node.id,
        outputs === undefined
          ? io
          : {
              ...io,
              dataOutputs: outputs.map(
                (port) => new Registration.DataOutputRef(port.id, port.type, port.name),
              ),
            },
      );
    });

    // Validate only the event's execution closure and its upstream data dependencies.
    // No schema.run, execution driver, or resource lookup may happen during this pass.
    const validateEventGraph = Effect.fnUntraced(function* (
      graph: Graph.Model,
      eventNode: Node.Model,
    ): Effect.fn.Return<void, ExecutorError> {
      const inspected = new Map<
        string,
        {
          node: Node.Model;
          schema: Registration.RegisteredSchema;
          io: Registration.RegisteredNodeIO;
        }
      >();
      const pending = [eventNode.id];
      const executionNodes = new Set<string>([eventNode.id]);
      const inspect = Effect.fnUntraced(function* (id: string) {
        const cached = inspected.get(id);
        if (cached !== undefined) return cached;
        const node = yield* Graph.getNode(graph, id);
        const schema = yield* getSchema(registeredModules, node);
        const properties = yield* resolveProperties(node, schema, false);
        const io = yield* generateNodeIO(graph, node, schema, properties);
        const result = { node, schema, io };
        inspected.set(id, result);
        return result;
      });
      const processed = new Set<string>();
      const followedExecution = new Set<string>();
      while (pending.length > 0) {
        const id = pending.shift()!;
        if (processed.has(id) && (!executionNodes.has(id) || followedExecution.has(id))) continue;
        processed.add(id);
        if (executionNodes.has(id)) followedExecution.add(id);
        const { node, schema, io } = yield* inspect(id);
        for (const property of schema.properties) {
          if ("resource" in property) continue;
          const value = Object.hasOwn(node.properties, property.id)
            ? node.properties[property.id]
            : property.defaultValue;
          if (value === undefined && property.optional) continue;
          if (!DataType.isValue(property.type, value))
            return yield* new InvalidGraph({
              graphId: graph.id,
              nodeId: node.id,
              reasons: [`Property ${property.id} does not match ${property.type._tag}`],
            });
        }
        const dependencyDefinitions: Record<string, DataType.Definition> = Object.create(null);
        const missing = new Set<string>();
        const visitType = (type: DataType.Any): void => {
          if (type._tag === "List") return visitType(type.item);
          if (type._tag === "Option") return visitType(type.inner);
          if (type._tag !== "Custom" || Object.hasOwn(dependencyDefinitions, type.id)) return;
          const definition = Object.hasOwn(currentProject.types, type.id)
            ? currentProject.types[type.id]
            : undefined;
          if (definition === undefined) {
            missing.add(type.id);
            return;
          }
          dependencyDefinitions[type.id] = definition;
          const fields =
            definition._tag === "Struct"
              ? definition.fields
              : definition.variants.flatMap((variant) => variant.fields);
          fields.forEach((field) => visitType(field.type));
        };
        [
          ...io.dataInputs,
          ...io.dataOutputs,
          ...io.executionInputs.flatMap((port) => port.scope ?? []),
          ...io.executionOutputs.flatMap((port) => port.scope ?? []),
        ].forEach((port) => visitType(port.type));
        const reasons = [
          ...Array.from(missing, (id) => `Unknown type ${id}`),
          ...TypeDefinition.validate(dependencyDefinitions).map((error) => error.reason),
        ];
        if (
          [
            ...io.dataInputs,
            ...io.dataOutputs,
            ...io.executionInputs.flatMap((port) => port.scope ?? []),
            ...io.executionOutputs.flatMap((port) => port.scope ?? []),
          ].some((port) => DataType.hasWildcard(port.type))
        )
          reasons.push("Unresolved wildcard type; connect it to a concrete type before execution");
        if (
          schema.type === "pure" &&
          [...io.executionInputs, ...io.executionOutputs].some((port) => port.scope !== undefined)
        )
          reasons.push("Pure nodes cannot consume or emit scopes");
        if (node.schema.package === "list" && node.schema.schema === "ListCreate") {
          const count = node.properties.number ?? 1;
          if (
            typeof count !== "number" ||
            !Number.isSafeInteger(count) ||
            count < 0 ||
            count > 1024
          )
            reasons.push("List entries must be an integer between 0 and 1024");
        }
        if (reasons.length > 0)
          return yield* new InvalidGraph({ graphId: graph.id, nodeId: node.id, reasons });
        for (const [inputId, value] of Object.entries(node.inputDefaults)) {
          const inputs = io.dataInputs.filter((input) => input.id === inputId);
          if (inputs.length !== 1 || io.executionInputs.some((input) => input.id === inputId))
            return yield* new InvalidInputValue({
              nodeId: node.id,
              inputId,
              reason: "Stored default refers to a missing or ambiguous data input",
            });
          yield* Schema.decodeUnknownEffect(
            DataType.JsonValueSchema(inputs[0]!.type, currentProject.types),
          )(value, { onExcessProperty: "error" }).pipe(
            Effect.catchCause(
              () =>
                new InvalidInputValue({
                  nodeId: node.id,
                  inputId,
                  reason: "Stored default does not match the current project type",
                }),
            ),
          );
        }
        for (const input of io.dataInputs) {
          const incoming = graph.connections.filter(
            (connection) => connection.inNodeId === node.id && connection.inIoId === input.id,
          );
          if (incoming.length > 1)
            return yield* new InvalidConnection({
              connectionId: incoming[1]!.id,
              reason: `Input ${input.id} has multiple connections`,
            });
          if (incoming.length === 0 && !Object.hasOwn(node.inputDefaults, input.id)) {
            if (input.defaultValue === undefined)
              return yield* new MissingInput({ nodeId: node.id, inputId: input.id });
            yield* Schema.decodeUnknownEffect(
              DataType.ValueSchema(input.type, currentProject.types),
            )(input.defaultValue, { onExcessProperty: "error" }).pipe(
              Effect.catchCause(
                () =>
                  new InvalidInputValue({
                    nodeId: node.id,
                    inputId: input.id,
                    reason: "Declaration default does not match the current project type",
                  }),
              ),
            );
          }
        }
        for (const connection of graph.connections) {
          const incoming = connection.inNodeId === node.id;
          const outgoing = connection.outNodeId === node.id;
          if (!incoming && !outgoing) continue;
          if (
            incoming &&
            !outgoing &&
            io.executionInputs.some((port) => port.id === connection.inIoId) &&
            !executionNodes.has(connection.outNodeId)
          )
            continue;
          const source = outgoing ? { node, schema, io } : yield* inspect(connection.outNodeId);
          const output = OutputRef.resolve(source.io, connection.outIo);
          if (output === undefined)
            return yield* new InvalidConnection({
              connectionId: connection.id,
              reason: `Output ${OutputRef.key(connection.outIo)} is missing or ambiguous`,
            });
          // Data consumers outside this event closure are not executed or validated.
          if (
            outgoing &&
            output.kind === "data" &&
            !processed.has(connection.inNodeId) &&
            !executionNodes.has(connection.inNodeId)
          )
            continue;
          if (outgoing && output.kind === "execution" && !executionNodes.has(node.id)) continue;
          const target = incoming ? { node, schema, io } : yield* inspect(connection.inNodeId);
          const targetData = target.io.dataInputs.filter((port) => port.id === connection.inIoId);
          const targetExec = target.io.executionInputs.filter(
            (port) => port.id === connection.inIoId,
          );
          if (
            targetData.length + targetExec.length !== 1 ||
            (output.kind === "data"
              ? targetData.length !== 1 || !DataType.equals(output.port.type, targetData[0]!.type)
              : targetExec.length !== 1 ||
                !Registration.scopesCompatible(output.port.scope, targetExec[0]?.scope) ||
                (target.schema.type !== "exec" && target.schema.type !== "base"))
          )
            return yield* new InvalidConnection({
              connectionId: connection.id,
              reason: "Wire endpoints are missing, ambiguous, or incompatible",
            });
          const duplicates = graph.connections.filter(
            (candidate) =>
              candidate.inNodeId === connection.inNodeId && candidate.inIoId === connection.inIoId,
          );
          if (duplicates.length > 1)
            return yield* new InvalidConnection({
              connectionId: duplicates[1]!.id,
              reason: `Input ${connection.inIoId} has multiple connections`,
            });
          if (incoming && output.kind === "data") pending.push(source.node.id);
          if (outgoing && output.kind === "execution" && executionNodes.has(node.id)) {
            executionNodes.add(target.node.id);
            pending.push(target.node.id);
          }
        }
      }
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const checkCycle = (id: string, data: boolean): string | undefined => {
        if (visiting.has(id)) return id;
        if (visited.has(id)) return;
        visiting.add(id);
        const current = inspected.get(id)!;
        for (const connection of graph.connections) {
          const next = data
            ? connection.inNodeId === id &&
              current.io.dataInputs.some((port) => port.id === connection.inIoId) &&
              inspected.get(connection.outNodeId)?.schema.type === "pure"
              ? connection.outNodeId
              : undefined
            : connection.outNodeId === id &&
                executionNodes.has(id) &&
                OutputRef.resolve(current.io, connection.outIo)?.kind === "execution"
              ? connection.inNodeId
              : undefined;
          if (next === undefined) continue;
          const cycle = checkCycle(next, data);
          if (cycle !== undefined) return cycle;
        }
        visiting.delete(id);
        visited.add(id);
      };
      for (const data of [false, true]) {
        visiting.clear();
        visited.clear();
        for (const id of processed) {
          const cycle = checkCycle(id, data);
          if (cycle !== undefined) return yield* new ExecutionCycle({ nodeId: cycle });
        }
      }
    });

    const executeEventNode = Effect.fn("Executor.executeEventNode")(function* (
      graph: Graph.Model,
      eventNode: Node.Model,
      eventSchema: Registration.RegisteredSchema,
    ): Effect.fn.Return<void, ExecutorError> {
      yield* validateEventGraph(graph, eventNode);
      const executionTraceId = crypto.randomUUID();
      const executionAttributes = {
        "macrograph.project.id": projectId,
        "macrograph.graph.id": graph.id,
        "macrograph.event_node.id": eventNode.id,
        "macrograph.execution.id": executionTraceId,
      };
      yield* Effect.annotateCurrentSpan({
        ...executionAttributes,
        "macrograph.graph.name": graph.name,
      });
      const state: ExecutionState = {
        outputs: new Map(),
        nodeIO: new Map(),
        completedPureNodes: new Set(),
        runningPureNodes: new Set(),
      };

      const runNode = Effect.fn("Executor.runNode")(function* (
        node: Node.Model,
        schema: Registration.RegisteredSchema,
        executionPath: string,
        scopes: ScopeActivations,
        parentTraceId?: string,
        incomingScope?: {
          readonly inputId: string;
          readonly payload: Readonly<Record<string, unknown>>;
        },
      ): Effect.fn.Return<
        {
          readonly executionOutputId: string | null;
          readonly traceId: string;
          readonly scopePayload?: Readonly<Record<string, unknown>>;
        },
        ExecutorError
      > {
        const traceId = crypto.randomUUID();
        const nodeAttributes = {
          ...executionAttributes,
          "macrograph.trace.id": traceId,
          "macrograph.node.id": node.id,
          "macrograph.node.name": node.name,
          "macrograph.node.kind": schema.type,
          "macrograph.module.id": node.schema.package,
          "macrograph.schema.id": node.schema.schema,
          "macrograph.execution.path": executionPath,
          ...(parentTraceId === undefined ? {} : { "macrograph.trace.parent.id": parentTraceId }),
        };
        yield* Effect.annotateCurrentSpan(nodeAttributes);
        const registeredModule = registeredModules.get(node.schema.package);
        if (registeredModule === undefined)
          return yield* new ModuleNotRegistered({ moduleId: node.schema.package });
        if (
          schema.properties.some((property) => "resource" in property) &&
          registeredModule.engineClient === undefined
        )
          return yield* new EngineClientUnavailable({ moduleId: node.schema.package });
        const resolvedProperties = yield* resolveProperties(node, schema);
        const nodeIO = yield* generateNodeIO(graph, node, schema, resolvedProperties);
        state.nodeIO.set(node.id, nodeIO);
        for (const input of nodeIO.executionInputs) {
          if (input.scope !== undefined && incomingScope?.inputId !== input.id)
            return yield* new MissingInput({ nodeId: node.id, inputId: input.id });
        }
        const inputs = new Map<string, unknown>();
        yield* Effect.forEach(
          nodeIO.dataInputs,
          (input) =>
            resolveInput(node, input, executionPath, traceId, scopes).pipe(
              Effect.tap((value) =>
                Effect.sync(() => {
                  inputs.set(input.id, value);
                }),
              ),
            ),
          { discard: true },
        );

        const handleRunCause = (
          cause: Cause.Cause<unknown>,
        ): Effect.Effect<never, EngineClientUnavailable | NodeExecutionError> => {
          const error = Cause.squash(cause);
          return isEngineClientUnavailable(error)
            ? Effect.fail(error)
            : Effect.fail(new NodeExecutionError({ nodeId: node.id, cause }));
        };
        const execute = Effect.gen(function* () {
          const outputs: Array<NodeOutput> = [];
          if (Scopes.isBreakScope(node)) {
            return {
              outputs: nodeIO.dataOutputs.map((port) => ({
                outputId: port.id,
                value: incomingScope?.payload[port.id],
              })),
              executionOutputId: "exec",
            } satisfies NodeExecutionResult;
          }
          const selected = selectOutput(
            nodeIO,
            yield* Effect.suspend(() =>
              schema.run({
                types: {
                  resolve: (type) => wildcardGraphs.get(graph.id)!.resolve(node.id, type),
                  definitions: currentProject.types,
                },
                input: (input) => inputs.get(input.id),
                scopeInput: (input) =>
                  incomingScope?.inputId === input.id ? incomingScope.payload : undefined,
                output: (output, value) => {
                  outputs.push({ outputId: output.id, value });
                },
                properties: resolvedProperties,
                event,
                engine: registeredModule.engineClient,
                execution: {
                  projectId,
                  graphId: graph.id,
                  eventNodeId: eventNode.id,
                  traceId: executionTraceId,
                },
                node: {
                  nodeId: node.id,
                  kind: schema.type,
                  executionPath,
                  traceId,
                  ...(parentTraceId === undefined ? {} : { parentTraceId }),
                  withSpan: (name, effect) =>
                    effect.pipe(
                      Effect.withSpan(name, {
                        attributes: nodeAttributes,
                      }),
                    ),
                },
              }),
            ).pipe(
              Effect.withSpan(`Schema.run ${node.schema.package}.${node.schema.schema}`, {
                attributes: nodeAttributes,
              }),
              Effect.catchCause(handleRunCause),
            ),
          );
          return {
            outputs,
            executionOutputId: selected?.id ?? null,
            ...(selected instanceof Registration.ScopeExecution
              ? { scopePayload: selected.payload }
              : {}),
          } satisfies NodeExecutionResult;
        });

        const transformResult = Effect.fnUntraced(function* (
          result: NodeExecutionResult,
          transform: (
            type: DataType.Any,
            value: unknown,
          ) => Effect.Effect<unknown, Schema.SchemaError>,
        ) {
          const branch = nodeIO.executionOutputs.find(
            (port) => port.id === result.executionOutputId,
          );
          const fields = branch?.scope;
          let scopePayload: Readonly<Record<string, unknown>> | undefined;
          if (fields !== undefined) {
            const payload = result.scopePayload;
            if (
              payload === undefined ||
              payload === null ||
              typeof payload !== "object" ||
              Object.keys(payload).length !== fields.length ||
              fields.some((field) => !Object.hasOwn(payload, field.id)) ||
              new Set(fields.map((field) => field.id)).size !== fields.length
            )
              return yield* new InvalidOutputValue({
                nodeId: node.id,
                outputId: branch!.id,
                reason: "Scope payload must contain exactly the declared fields",
              });
            scopePayload = Object.fromEntries(
              yield* Effect.forEach(fields, (field) =>
                transform(field.type, payload[field.id]).pipe(
                  Effect.map((value) => [field.id, value] as const),
                  Effect.catchCause(
                    () =>
                      new InvalidOutputValue({
                        nodeId: node.id,
                        outputId: branch!.id,
                        reason: `Invalid scope field ${field.id}`,
                      }),
                  ),
                ),
              ),
            );
          } else if (result.scopePayload !== undefined) {
            return yield* new InvalidOutputValue({
              nodeId: node.id,
              outputId: result.executionOutputId ?? "",
              reason: "Payload requires a declared scope output",
            });
          }
          const outputs = yield* Effect.forEach(result.outputs, (output) => {
            const ports = nodeIO.dataOutputs.filter((port) => port.id === output.outputId);
            if (
              ports.length !== 1 ||
              nodeIO.executionOutputs.some((port) => port.id === output.outputId)
            )
              return Effect.fail(
                new InvalidOutputValue({
                  nodeId: node.id,
                  outputId: output.outputId,
                  reason: `Expected ${ports[0]?.type._tag ?? "a declared data output"}`,
                }),
              );
            return transform(ports[0]!.type, output.value).pipe(
              Effect.map((value) => ({ ...output, value })),
              Effect.catchCause(
                () =>
                  new InvalidOutputValue({
                    nodeId: node.id,
                    outputId: output.outputId,
                    reason: `Expected ${ports[0]!.type._tag}`,
                  }),
              ),
            );
          });
          return { ...result, outputs, ...(scopePayload === undefined ? {} : { scopePayload }) };
        });

        const result =
          schema.type === "pure"
            ? yield* execute
            : yield* executionDriver
                .executeNode(
                  {
                    projectId,
                    graphId: graph.id,
                    eventNodeId: eventNode.id,
                    nodeId: node.id,
                    kind: schema.type,
                    executionPath,
                    executionTraceId,
                    traceId,
                    ...(parentTraceId === undefined ? {} : { parentTraceId }),
                  },
                  execute.pipe(
                    Effect.flatMap((result) =>
                      transformResult(result, (type, value) =>
                        Schema.encodeUnknownEffect(
                          DataType.JsonValueSchema(type, currentProject.types),
                        )(value),
                      ),
                    ),
                  ),
                )
                .pipe(
                  Effect.flatMap((result) =>
                    transformResult(result, (type, value) =>
                      Schema.decodeUnknownEffect(
                        DataType.JsonValueSchema(type, currentProject.types),
                      )(value),
                    ),
                  ),
                );

        // An exec node may emit different payloads on successive branches. Never retain
        // outputs from its previous invocation (including a previous enum match branch).
        for (const port of nodeIO.dataOutputs) state.outputs.delete(outputKey(node.id, port.id));
        for (const output of result.outputs) {
          const ports = nodeIO.dataOutputs.filter((port) => port.id === output.outputId);
          if (
            ports.length !== 1 ||
            nodeIO.executionOutputs.some((port) => port.id === output.outputId)
          ) {
            return yield* new InvalidOutputValue({
              nodeId: node.id,
              outputId: output.outputId,
              reason: `Expected ${ports[0]?.type._tag ?? "a declared data output"}`,
            });
          }
          yield* Schema.decodeUnknownEffect(
            DataType.ValueSchema(ports[0]!.type, currentProject.types),
          )(output.value).pipe(
            Effect.catchCause(
              () =>
                new InvalidOutputValue({
                  nodeId: node.id,
                  outputId: output.outputId,
                  reason: `Expected ${ports[0]!.type._tag}`,
                }),
            ),
          );
          state.outputs.set(outputKey(node.id, output.outputId), output.value);
        }
        if (
          result.executionOutputId !== null &&
          nodeIO.executionOutputs.filter((port) => port.id === result.executionOutputId).length !==
            1
        )
          return yield* new InvalidGraph({
            graphId: graph.id,
            nodeId: node.id,
            reasons: ["Execution driver returned an undeclared branch"],
          });
        yield* Effect.annotateCurrentSpan(
          "macrograph.execution.output.id",
          result.executionOutputId,
        );
        return {
          executionOutputId: result.executionOutputId,
          traceId,
          ...(result.scopePayload === undefined ? {} : { scopePayload: result.scopePayload }),
        };
      });

      const runPureNode = Effect.fnUntraced(function* (
        node: Node.Model,
        schema: Registration.RegisteredSchema,
        executionPath: string,
        parentTraceId: string,
        scopes: ScopeActivations,
      ): Effect.fn.Return<void, ExecutorError> {
        if (state.completedPureNodes.has(node.id)) return;
        if (state.runningPureNodes.has(node.id))
          return yield* new ExecutionCycle({ nodeId: node.id });
        state.runningPureNodes.add(node.id);
        yield* runNode(node, schema, executionPath, scopes, parentTraceId);
        state.runningPureNodes.delete(node.id);
        state.completedPureNodes.add(node.id);
      });

      const resolveInput = Effect.fn("Executor.resolveInput")(function* (
        node: Node.Model,
        input: Registration.DataInputRef,
        executionPath: string,
        parentTraceId: string,
        scopes: ScopeActivations,
      ): Effect.fn.Return<unknown, ExecutorError> {
        yield* Effect.annotateCurrentSpan({
          ...executionAttributes,
          "macrograph.node.id": node.id,
          "macrograph.input.id": input.id,
          "macrograph.input.type": input.type._tag,
          "macrograph.execution.path": executionPath,
          "macrograph.trace.parent.id": parentTraceId,
        });
        const connections = graph.connections.filter(
          (candidate) => candidate.inNodeId === node.id && candidate.inIoId === input.id,
        );
        if (connections.length > 1)
          return yield* new InvalidConnection({
            connectionId: connections[1]!.id,
            reason: `Input ${input.id} has multiple connections`,
          });
        const connection = connections[0];
        if (connection === undefined) {
          yield* Effect.annotateCurrentSpan(
            "macrograph.input.source",
            Object.hasOwn(node.inputDefaults, input.id)
              ? "stored-default"
              : input.defaultValue !== undefined
                ? "schema-default"
                : "missing",
          );
          if (Object.hasOwn(node.inputDefaults, input.id)) {
            return yield* Schema.decodeUnknownEffect(
              DataType.JsonValueSchema(input.type, currentProject.types),
            )(node.inputDefaults[input.id]).pipe(
              Effect.catchCause(
                () =>
                  new InvalidInputValue({
                    nodeId: node.id,
                    inputId: input.id,
                    reason: `Stored default does not match ${input.type._tag}`,
                  }),
              ),
            );
          }
          if (input.defaultValue !== undefined) {
            return yield* Schema.decodeUnknownEffect(
              DataType.ValueSchema(input.type, currentProject.types),
            )(input.defaultValue).pipe(
              Effect.catchCause(
                () =>
                  new InvalidInputValue({
                    nodeId: node.id,
                    inputId: input.id,
                    reason: `Declaration default does not match ${input.type._tag}`,
                  }),
              ),
            );
          }
          return yield* new MissingInput({ nodeId: node.id, inputId: input.id });
        }

        yield* Effect.annotateCurrentSpan({
          "macrograph.input.source": "connection",
          "macrograph.connection.id": connection.id,
          "macrograph.source.node.id": connection.outNodeId,
          "macrograph.source.output.id": OutputRef.parentId(connection.outIo),
        });
        const sourceNode = yield* Graph.getNode(graph, connection.outNodeId);
        const sourceSchema = yield* getSchema(registeredModules, sourceNode);
        if (sourceSchema.type === "pure")
          yield* runPureNode(
            sourceNode,
            sourceSchema,
            `${executionPath}/data:${connection.id}`,
            parentTraceId,
            scopes,
          );
        const sourceIO =
          state.nodeIO.get(sourceNode.id) ??
          (yield* generateNodeIO(
            graph,
            sourceNode,
            sourceSchema,
            yield* resolveProperties(sourceNode, sourceSchema),
          ));
        const resolved = OutputRef.resolve(sourceIO, connection.outIo);
        if (resolved?.kind !== "data")
          return yield* new InvalidConnection({
            connectionId: connection.id,
            reason: `Output ${OutputRef.key(connection.outIo)} is not a data output`,
          });
        const output = resolved.port;
        if (!DataType.equals(output.type, input.type))
          return yield* new InvalidConnection({
            connectionId: connection.id,
            reason: `Output ${OutputRef.key(connection.outIo)} is incompatible with input ${input.id}`,
          });
        let value: unknown;
        if (connection.outIo._tag === "ScopeField") {
          const activation = scopes.get(sourceNode.id);
          if (activation?.scopeId !== connection.outIo.scope)
            return yield* new ScopeNotActive({
              nodeId: sourceNode.id,
              scopeId: connection.outIo.scope,
            });
          value = activation.payload[connection.outIo.field];
        } else {
          const key = outputKey(sourceNode.id, OutputRef.parentId(connection.outIo));
          if (!state.outputs.has(key))
            return yield* new MissingOutput({
              nodeId: sourceNode.id,
              outputId: OutputRef.parentId(connection.outIo),
            });
          value = state.outputs.get(key);
        }
        return yield* Schema.decodeUnknownEffect(
          DataType.ValueSchema(input.type, currentProject.types),
        )(value).pipe(
          Effect.catchCause(
            () =>
              new InvalidInputValue({
                nodeId: node.id,
                inputId: input.id,
                reason: `Connected value does not match ${input.type._tag}`,
              }),
          ),
        );
      });

      const selectOutput = (
        io: Registration.RegisteredNodeIO,
        selected: void | Registration.ExecutionOutputRef,
      ) =>
        selected ??
        io.executionOutputs.find((output) => output.id === "exec") ??
        (io.executionOutputs.length === 1 ? io.executionOutputs[0] : undefined);

      const followExecution = (
        currentNode: Node.Model,
        currentSchema: Registration.RegisteredSchema,
        outputId: string,
        sourceTraceId: string,
        executionPath: string,
        path: ReadonlySet<string>,
        scopes: ScopeActivations,
        scopePayload?: Readonly<Record<string, unknown>>,
      ): Effect.Effect<void, ExecutorError> =>
        Effect.gen(function* () {
          const connections = graph.connections.filter(
            (candidate) =>
              candidate.outNodeId === currentNode.id &&
              candidate.outIo._tag !== "ScopeField" &&
              OutputRef.parentId(candidate.outIo) === outputId,
          );
          if (connections.length === 0) return;
          const currentIO =
            state.nodeIO.get(currentNode.id) ??
            (yield* generateNodeIO(
              graph,
              currentNode,
              currentSchema,
              yield* resolveProperties(currentNode, currentSchema),
            ));
          if (
            currentIO.executionOutputs.filter((output) => output.id === outputId).length !== 1 ||
            currentIO.dataOutputs.some((output) => output.id === outputId)
          )
            return yield* new InvalidConnection({
              connectionId: connections[0]!.id,
              reason: `Output ${outputId} is not an unambiguous execution output`,
            });

          // Copy on branch entry: sibling paths must never see each other's activations.
          const branchScopes: ScopeActivations = new Map(scopes).set(
            currentNode.id,
            scopePayload === undefined ? undefined : { scopeId: outputId, payload: scopePayload },
          );
          for (const connection of connections) {
            const incoming = graph.connections.filter(
              (candidate) =>
                candidate.inNodeId === connection.inNodeId &&
                candidate.inIoId === connection.inIoId,
            );
            if (incoming.length > 1)
              return yield* new InvalidConnection({
                connectionId: incoming[1]!.id,
                reason: `Input ${connection.inIoId} has multiple connections`,
              });

            const nextNode = yield* Graph.getNode(graph, connection.inNodeId);
            if (path.has(nextNode.id)) return yield* new ExecutionCycle({ nodeId: nextNode.id });
            const nextSchema = yield* getSchema(registeredModules, nextNode);
            if (nextSchema.type !== "exec" && nextSchema.type !== "base")
              return yield* new InvalidConnection({
                connectionId: connection.id,
                reason: `Execution flow cannot target a ${nextSchema.type} schema`,
              });
            const nextIO = yield* generateNodeIO(
              graph,
              nextNode,
              nextSchema,
              yield* resolveProperties(nextNode, nextSchema),
            );
            if (
              nextIO.executionInputs.filter((input) => input.id === connection.inIoId).length !==
                1 ||
              nextIO.dataInputs.some((input) => input.id === connection.inIoId)
            )
              return yield* new InvalidConnection({
                connectionId: connection.id,
                reason: `Input ${connection.inIoId} is not an execution input`,
              });

            state.completedPureNodes.clear();
            state.runningPureNodes.clear();
            const nextExecutionPath = `${executionPath}/exec:${connection.id}`;
            const result = yield* runNode(
              nextNode,
              nextSchema,
              nextExecutionPath,
              branchScopes,
              sourceTraceId,
              scopePayload === undefined || connection.outIo._tag !== "Port"
                ? undefined
                : { inputId: connection.inIoId, payload: scopePayload },
            );
            if (result.executionOutputId !== null) {
              yield* followExecution(
                nextNode,
                nextSchema,
                result.executionOutputId,
                result.traceId,
                nextExecutionPath,
                new Set([...path, nextNode.id]),
                branchScopes,
                result.scopePayload,
              );
            }
          }
        });

      const executionPath = `event:${eventNode.id}`;
      const eventResult = yield* runNode(eventNode, eventSchema, executionPath, new Map());
      if (eventResult.executionOutputId !== null) {
        yield* followExecution(
          eventNode,
          eventSchema,
          eventResult.executionOutputId,
          eventResult.traceId,
          executionPath,
          new Set([eventNode.id]),
          new Map(),
          eventResult.scopePayload,
        );
      }
    });

    yield* Effect.forEach(
      Object.values(currentProject.graphs),
      (graph) =>
        Effect.forEach(
          Object.values(graph.nodes).filter((node) => node.schema.package === definition.id),
          (node) =>
            Effect.gen(function* () {
              const schema = registeredModules
                .get(node.schema.package)
                ?.schemas.get(node.schema.schema);
              if (schema === undefined || schema.type !== "event") return;
              const matches = yield* resolveProperties(node, schema, false).pipe(
                Effect.flatMap((properties) => schema.matches(event, properties)),
                Effect.tap((matched) =>
                  Effect.annotateCurrentSpan("macrograph.event.matched", matched),
                ),
                Effect.withSpan("Executor.matchEvent", {
                  attributes: {
                    "macrograph.project.id": projectId,
                    "macrograph.graph.id": graph.id,
                    "macrograph.node.id": node.id,
                    "macrograph.module.id": node.schema.package,
                    "macrograph.schema.id": node.schema.schema,
                  },
                }),
              );
              if (matches) yield* executeEventNode(graph, node, schema);
            }),
          { concurrency: "unbounded", discard: true },
        ),
      { concurrency: "unbounded", discard: true },
    );
  });

  return {
    project: Ref.get(project),
    loadProject: (nextProject) => Ref.set(project, nextProject),
    module: registerModule,
    handleEvent: (module, event) => {
      const emittedEvent: { readonly _tag: string } = event;
      return handleEvent(module, event).pipe(
        Effect.withSpan("Executor.handleEvent", {
          kind: "consumer",
          attributes: {
            "macrograph.project.id": projectId,
            "macrograph.module.id": module.id,
            "macrograph.event.type": emittedEvent._tag,
          },
        }),
      );
    },
  };
});

export * as Executor from "./Executor.ts";
