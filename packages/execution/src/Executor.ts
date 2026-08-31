import {
  CustomTypes,
  Graph,
  Node,
  Project,
  ResourceConstant,
  TypeDefinition,
} from "@macrograph/core";
import { DataType } from "@macrograph/plugin/DataType";
import * as Engine from "@macrograph/plugin/Engine";
import * as Plugin from "@macrograph/plugin/Plugin";
import * as Registration from "@macrograph/plugin/Registration";
import { Cause, Effect, Ref, Schema } from "effect";

const NodeOutputKey = Schema.String.pipe(Schema.brand("NodeOutputKey"));
type NodeOutputKey = typeof NodeOutputKey.Type;

export class PluginNotRegistered extends Schema.TaggedError<PluginNotRegistered>()(
  "PluginNotRegistered",
  { pluginId: Schema.String },
) {}

export class SchemaNotRegistered extends Schema.TaggedError<SchemaNotRegistered>()(
  "SchemaNotRegistered",
  { pluginId: Schema.String, schemaId: Schema.String },
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
  { pluginId: Schema.String },
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
  | PluginNotRegistered
  | SchemaNotRegistered
  | InvalidConnection
  | MissingInput
  | MissingOutput
  | InvalidInputValue
  | InvalidOutputValue
  | ExecutionCycle
  | ResourceResolutionError
  | EngineClientUnavailable
  | NodeExecutionError
  | InvalidGraph
  | Node.NotFoundError;

interface RegisteredPlugin {
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
  readonly plugin: <Definition extends Engine.AnyDef = never>(
    ...args: Plugin.RegisterArgs<Definition>
  ) => Effect.Effect<void>;
  readonly handleEvent: <Definition extends Engine.AnyDef>(
    plugin: Plugin.Plugin<Definition>,
    event: Engine.EventOf<Definition>,
  ) => Effect.Effect<void, ExecutorError>;
}

export interface NodeExecutionKey {
  readonly projectId: string;
  readonly graphId: string;
  readonly eventNodeId: string;
  readonly nodeId: string;
  readonly kind: "event" | "exec";
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
  readonly engineClient?: (pluginId: string) => Effect.Effect<unknown>;
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
  const plugins = yield* Ref.make<ReadonlyMap<string, RegisteredPlugin>>(new Map());
  const executionDriver = options?.executionDriver ?? inlineExecutionDriver;
  const projectId = options?.projectId ?? "local";

  const registerPlugin: Service["plugin"] = Effect.fnUntraced(function* (...args) {
    const [definition, deployment] = args;
    if (
      definition.engine !== undefined &&
      (deployment === undefined ||
        deployment.pluginId !== definition.id ||
        deployment.definition !== definition.engine)
    )
      return yield* Effect.die(`Deployment does not match plugin ${definition.id}`);
    const registered = yield* Registration.collect(definition.effect);
    const engineClient =
      definition.engine === undefined
        ? undefined
        : options?.engineClient === undefined
          ? new Proxy(
              {},
              {
                get: () => () =>
                  Effect.fail(new EngineClientUnavailable({ pluginId: definition.id })),
              },
            )
          : yield* options.engineClient(definition.id);
    yield* Ref.update(plugins, (current) => {
      const next = new Map(current);
      next.set(definition.id, {
        schemas: new Map(registered.map((schema) => [schema.id, schema])),
        engineClient,
      });
      return next;
    });
  });

  const getSchema = Effect.fnUntraced(function* (
    registeredPlugins: ReadonlyMap<string, RegisteredPlugin>,
    node: Node.Model,
  ) {
    const registeredPlugin = registeredPlugins.get(node.schema.package);
    if (registeredPlugin === undefined)
      return yield* new PluginNotRegistered({ pluginId: node.schema.package });
    const schema = registeredPlugin.schemas.get(node.schema.schema);
    if (schema === undefined)
      return yield* new SchemaNotRegistered({
        pluginId: node.schema.package,
        schemaId: node.schema.schema,
      });
    return schema;
  });

  const handleEvent: Service["handleEvent"] = Effect.fnUntraced(function* (definition, event) {
    const currentProject = yield* Ref.get(project);
    const registeredPlugins = new Map(yield* Ref.get(plugins));
    registeredPlugins.set(CustomTypes.packageId, {
      schemas: CustomTypes.schemas(currentProject.types),
      engineClient: undefined,
    });
    if (!registeredPlugins.has(definition.id))
      return yield* new PluginNotRegistered({ pluginId: definition.id });

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
        const schema = yield* getSchema(registeredPlugins, node);
        const properties = yield* resolveProperties(node, schema, false);
        const io = yield* Effect.try({
          try: () => schema.generateIO(properties),
          catch: () =>
            new InvalidGraph({
              graphId: graph.id,
              nodeId: node.id,
              reasons: ["Schema IO could not be generated"],
            }),
        });
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
        [...io.dataInputs, ...io.dataOutputs].forEach((port) => visitType(port.type));
        const reasons = [
          ...Array.from(missing, (id) => `Unknown type ${id}`),
          ...TypeDefinition.validate(dependencyDefinitions).map((error) => error.reason),
        ];
        if (
          node.schema.package === "list" &&
          node.schema.schema !== "JoinStringList" &&
          DataType.parseSelector(
            typeof node.properties.type === "string" ? node.properties.type : "String",
          ) === undefined
        )
          reasons.push("Invalid list element type selector");
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
          const sourceData = source.io.dataOutputs.filter((port) => port.id === connection.outIoId);
          const sourceExec = source.io.executionOutputs.filter(
            (port) => port.id === connection.outIoId,
          );
          if (sourceData.length + sourceExec.length !== 1)
            return yield* new InvalidConnection({
              connectionId: connection.id,
              reason: `Output ${connection.outIoId} is missing or ambiguous`,
            });
          // Data consumers outside this event closure are not executed or validated.
          if (
            outgoing &&
            sourceData.length === 1 &&
            !processed.has(connection.inNodeId) &&
            !executionNodes.has(connection.inNodeId)
          )
            continue;
          if (outgoing && sourceExec.length === 1 && !executionNodes.has(node.id)) continue;
          const target = incoming ? { node, schema, io } : yield* inspect(connection.inNodeId);
          const targetData = target.io.dataInputs.filter((port) => port.id === connection.inIoId);
          const targetExec = target.io.executionInputs.filter(
            (port) => port.id === connection.inIoId,
          );
          if (
            targetData.length + targetExec.length !== 1 ||
            (sourceData.length === 1
              ? targetData.length !== 1 ||
                !DataType.equals(sourceData[0]!.type, targetData[0]!.type)
              : targetExec.length !== 1 || target.schema.type !== "exec")
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
          if (incoming && sourceData.length === 1) pending.push(source.node.id);
          if (outgoing && sourceExec.length === 1 && executionNodes.has(node.id)) {
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
                current.io.executionOutputs.some((port) => port.id === connection.outIoId)
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
        parentTraceId?: string,
      ): Effect.fn.Return<
        { readonly executionOutputId: string | null; readonly traceId: string },
        ExecutorError
      > {
        const traceId = crypto.randomUUID();
        const nodeAttributes = {
          ...executionAttributes,
          "macrograph.trace.id": traceId,
          "macrograph.node.id": node.id,
          "macrograph.node.name": node.name,
          "macrograph.node.kind": schema.type,
          "macrograph.plugin.id": node.schema.package,
          "macrograph.schema.id": node.schema.schema,
          "macrograph.execution.path": executionPath,
          ...(parentTraceId === undefined ? {} : { "macrograph.trace.parent.id": parentTraceId }),
        };
        yield* Effect.annotateCurrentSpan(nodeAttributes);
        const registeredPlugin = registeredPlugins.get(node.schema.package);
        if (registeredPlugin === undefined)
          return yield* new PluginNotRegistered({ pluginId: node.schema.package });
        if (
          schema.properties.some((property) => "resource" in property) &&
          registeredPlugin.engineClient === undefined
        )
          return yield* new EngineClientUnavailable({ pluginId: node.schema.package });
        const resolvedProperties = yield* resolveProperties(node, schema);
        const nodeIO = schema.generateIO(resolvedProperties);
        state.nodeIO.set(node.id, nodeIO);
        const inputs = new Map<string, unknown>();
        yield* Effect.forEach(
          nodeIO.dataInputs,
          (input) =>
            resolveInput(node, input, executionPath, traceId).pipe(
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
          const selected = selectOutput(
            nodeIO,
            yield* Effect.suspend(() =>
              schema.run({
                input: (input) => inputs.get(input.id),
                output: (output, value) => {
                  outputs.push({ outputId: output.id, value });
                },
                properties: resolvedProperties,
                event,
                engine: registeredPlugin.engineClient,
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
          } satisfies NodeExecutionResult;
        });

        const transformResult = Effect.fnUntraced(function* (
          result: NodeExecutionResult,
          transform: (
            type: DataType.Any,
            value: unknown,
          ) => Effect.Effect<unknown, Schema.SchemaError>,
        ) {
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
          return { ...result, outputs };
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

        if (node.schema.package === CustomTypes.packageId && nodeIO.executionInputs.length > 0) {
          if (
            result.executionOutputId === null ||
            result.outputs.some(
              (output) => !output.outputId.startsWith(`${result.executionOutputId}/`),
            )
          )
            return yield* new InvalidGraph({
              graphId: graph.id,
              nodeId: node.id,
              reasons: ["Enum match payload does not belong to the selected branch"],
            });
        }

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
        return { executionOutputId: result.executionOutputId, traceId };
      });

      const runPureNode = Effect.fnUntraced(function* (
        node: Node.Model,
        schema: Registration.RegisteredSchema,
        executionPath: string,
        parentTraceId: string,
      ): Effect.fn.Return<void, ExecutorError> {
        if (state.completedPureNodes.has(node.id)) return;
        if (state.runningPureNodes.has(node.id))
          return yield* new ExecutionCycle({ nodeId: node.id });
        state.runningPureNodes.add(node.id);
        yield* runNode(node, schema, executionPath, parentTraceId);
        state.runningPureNodes.delete(node.id);
        state.completedPureNodes.add(node.id);
      });

      const resolveInput = Effect.fn("Executor.resolveInput")(function* (
        node: Node.Model,
        input: Registration.DataInputRef,
        executionPath: string,
        parentTraceId: string,
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
          "macrograph.source.output.id": connection.outIoId,
        });
        const sourceNode = yield* Graph.getNode(graph, connection.outNodeId);
        const sourceSchema = yield* getSchema(registeredPlugins, sourceNode);
        if (sourceSchema.type === "pure")
          yield* runPureNode(
            sourceNode,
            sourceSchema,
            `${executionPath}/data:${connection.id}`,
            parentTraceId,
          );
        const sourceIO =
          state.nodeIO.get(sourceNode.id) ??
          sourceSchema.generateIO(yield* resolveProperties(sourceNode, sourceSchema));
        const outputs = sourceIO.dataOutputs.filter(
          (candidate) => candidate.id === connection.outIoId,
        );
        const executionOutputs = sourceIO.executionOutputs.filter(
          (candidate) => candidate.id === connection.outIoId,
        );
        if (outputs.length !== 1 || executionOutputs.length !== 0)
          return yield* new InvalidConnection({
            connectionId: connection.id,
            reason: `Output ${connection.outIoId} is not a data output`,
          });
        const output = outputs[0]!;
        if (!DataType.equals(output.type, input.type))
          return yield* new InvalidConnection({
            connectionId: connection.id,
            reason: `Output ${connection.outIoId} is incompatible with input ${input.id}`,
          });
        const key = outputKey(sourceNode.id, connection.outIoId);
        if (!state.outputs.has(key))
          return yield* new MissingOutput({
            nodeId: sourceNode.id,
            outputId: connection.outIoId,
          });
        const value = state.outputs.get(key);
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
      ): Effect.Effect<void, ExecutorError> =>
        Effect.gen(function* () {
          const connections = graph.connections.filter(
            (candidate) => candidate.outNodeId === currentNode.id && candidate.outIoId === outputId,
          );
          if (connections.length === 0) return;
          const currentIO =
            state.nodeIO.get(currentNode.id) ??
            currentSchema.generateIO(yield* resolveProperties(currentNode, currentSchema));
          if (
            currentIO.executionOutputs.filter((output) => output.id === outputId).length !== 1 ||
            currentIO.dataOutputs.some((output) => output.id === outputId)
          )
            return yield* new InvalidConnection({
              connectionId: connections[0]!.id,
              reason: `Output ${outputId} is not an unambiguous execution output`,
            });

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
            const nextSchema = yield* getSchema(registeredPlugins, nextNode);
            if (nextSchema.type !== "exec")
              return yield* new InvalidConnection({
                connectionId: connection.id,
                reason: `Execution flow cannot target a ${nextSchema.type} schema`,
              });
            const nextIO = nextSchema.generateIO(yield* resolveProperties(nextNode, nextSchema));
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
            const result = yield* runNode(nextNode, nextSchema, nextExecutionPath, sourceTraceId);
            if (result.executionOutputId !== null) {
              yield* followExecution(
                nextNode,
                nextSchema,
                result.executionOutputId,
                result.traceId,
                nextExecutionPath,
                new Set([...path, nextNode.id]),
              );
            }
          }
        });

      const executionPath = `event:${eventNode.id}`;
      const eventResult = yield* runNode(eventNode, eventSchema, executionPath);
      if (eventResult.executionOutputId !== null) {
        yield* followExecution(
          eventNode,
          eventSchema,
          eventResult.executionOutputId,
          eventResult.traceId,
          executionPath,
          new Set([eventNode.id]),
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
              const schema = registeredPlugins
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
                    "macrograph.plugin.id": node.schema.package,
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
    plugin: registerPlugin,
    handleEvent: (plugin, event) => {
      const emittedEvent: { readonly _tag: string } = event;
      return handleEvent(plugin, event).pipe(
        Effect.withSpan("Executor.handleEvent", {
          kind: "consumer",
          attributes: {
            "macrograph.project.id": projectId,
            "macrograph.plugin.id": plugin.id,
            "macrograph.event.type": emittedEvent._tag,
          },
        }),
      );
    },
  };
});

export * as Executor from "./Executor.ts";
