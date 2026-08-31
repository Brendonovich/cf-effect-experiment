import { FunctionGraph, Graph, Node, Project, ResourceConstant } from "@macrograph/core";
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

const isEngineClientUnavailable = (value: unknown): value is EngineClientUnavailable =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "EngineClientUnavailable";

export type ExecutorError =
  | Graph.FunctionError
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
  readonly invokeFunction: (
    graphId: string,
    inputs: Readonly<Record<string, unknown>>,
    options?: FunctionInvocationOptions,
  ) => Effect.Effect<Readonly<Record<string, unknown>>, ExecutorError>;
}

export interface FunctionInvocationOptions {
  readonly executionPath?: string;
  readonly queueLineage?: ReadonlyArray<string>;
  readonly executionTraceId?: string;
  readonly eventNodeId?: string;
}

export interface QueueInvocation {
  readonly key: NodeExecutionKey;
  readonly functionId: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly queueId: string;
  readonly queueLineage: ReadonlyArray<string>;
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
  readonly queueInvocation?: (
    invocation: QueueInvocation,
  ) => Effect.Effect<Readonly<Record<string, unknown>>, ExecutorError>;
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
    currentProject?: Project.Model,
    ownerGraph?: Graph.Model,
  ) {
    if (FunctionGraph.isFunctionNode(node)) {
      const target = node.properties.function;
      const graph = FunctionGraph.isBoundary(node)
        ? ownerGraph
        : typeof target === "string"
          ? currentProject?.graphs[target]
          : undefined;
      const model = (
        FunctionGraph.isQueuedCall(node) ? FunctionGraph.queuesPackage : FunctionGraph.pkg
      ).schemas.find((schema) => schema.id === node.schema.schema);
      if (model === undefined)
        return yield* new SchemaNotRegistered({
          pluginId: node.schema.package,
          schemaId: node.schema.schema,
        });
      const io = FunctionGraph.io(node.schema.schema, graph?.signature);
      const generated: Registration.RegisteredNodeIO = {
        dataInputs: io.dataInputs.map(
          (port) => new Registration.DataInputRef(port.id, port.type, port.name),
        ),
        dataOutputs: io.dataOutputs.map(
          (port) => new Registration.DataOutputRef(port.id, port.type, port.name),
        ),
        executionInputs: io.executionInputs.map(
          (port) => new Registration.ExecutionInputRef(port.id),
        ),
        executionOutputs: io.executionOutputs.map(
          (port) => new Registration.ExecutionOutputRef(port.id),
        ),
      };
      return {
        id: model.id,
        name: model.name,
        type: "exec",
        properties: [],
        ...generated,
        generateIO: () => generated,
        matches: () => Effect.succeed(false),
        run: () => Effect.void,
      } satisfies Registration.RegisteredSchema;
    }
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

  const execute = Effect.fnUntraced(function* (
    definition?: { readonly id: string },
    event?: { readonly _tag: string },
    invocation?: {
      readonly graphId: string;
      readonly inputs: Readonly<Record<string, unknown>>;
      readonly options?: FunctionInvocationOptions;
    },
  ) {
    const currentProject = yield* Ref.get(project);
    const registeredPlugins = yield* Ref.get(plugins);
    if (definition !== undefined && !registeredPlugins.has(definition.id))
      return yield* new PluginNotRegistered({ pluginId: definition.id });

    const resolveProperties = Effect.fnUntraced(function* (
      node: Node.Model,
      schema: Registration.RegisteredSchema,
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
        if (options?.resourceValues === undefined) {
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

    const executeEventNode = Effect.fn("Executor.executeEventNode")(function* (
      graph: Graph.Model,
      eventNode: Node.Model,
      eventSchema: Registration.RegisteredSchema,
      functionInputs?: Readonly<Record<string, unknown>>,
      callStack: ReadonlyArray<string> = [],
      invocationPath?: string,
      parentExecutionTraceId?: string,
      rootEventNodeId?: string,
    ): Effect.fn.Return<Readonly<Record<string, unknown>>, ExecutorError> {
      let functionResult: Readonly<Record<string, unknown>> | undefined;
      const executionTraceId = parentExecutionTraceId ?? crypto.randomUUID();
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
        if (registeredPlugin === undefined && !FunctionGraph.isFunctionNode(node))
          return yield* new PluginNotRegistered({ pluginId: node.schema.package });
        if (
          schema.properties.some((property) => "resource" in property) &&
          registeredPlugin?.engineClient === undefined
        )
          return yield* new EngineClientUnavailable({ pluginId: node.schema.package });
        const resolvedProperties = yield* resolveProperties(node, schema);
        const nodeIO = schema.generateIO(resolvedProperties);
        if (FunctionGraph.isCall(node)) {
          const target = node.properties.function;
          if (typeof target !== "string" || currentProject.graphs[target]?.kind !== "function")
            return yield* new Graph.FunctionError({
              graphId: graph.id,
              reason: `Call ${node.id} has a missing function target`,
            });
          const staleDefault = Object.keys(node.inputDefaults).find(
            (id) => !nodeIO.dataInputs.some((port) => port.id === id),
          );
          const staleConnection = graph.connections.find(
            (connection) =>
              (connection.inNodeId === node.id &&
                ![...nodeIO.dataInputs, ...nodeIO.executionInputs].some(
                  (port) => port.id === connection.inIoId,
                )) ||
              (connection.outNodeId === node.id &&
                ![...nodeIO.dataOutputs, ...nodeIO.executionOutputs].some(
                  (port) => port.id === connection.outIoId,
                )),
          );
          if (staleDefault !== undefined || staleConnection !== undefined)
            return yield* new Graph.FunctionError({
              graphId: graph.id,
              reason: `Call ${node.id} retains incompatible signature data; repair its defaults or connections before execution`,
            });
        }
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
          if (FunctionGraph.isFunctionNode(node)) {
            if (node.schema.schema === "input") {
              for (const field of graph.signature?.inputs ?? []) {
                if (functionInputs === undefined || !Object.hasOwn(functionInputs, field.id))
                  return yield* new MissingInput({ nodeId: node.id, inputId: field.id });
                outputs.push({ outputId: `gin:${field.id}`, value: functionInputs[field.id] });
              }
            } else if (node.schema.schema === "output") {
              if (functionResult !== undefined)
                return yield* new Graph.FunctionError({
                  graphId: graph.id,
                  reason: "Function returned more than once",
                });
              functionResult = Object.fromEntries(
                (graph.signature?.outputs ?? []).map((field) => [
                  field.id,
                  inputs.get(`gout:${field.id}`),
                ]),
              );
            } else {
              const target = node.properties.function;
              if (typeof target !== "string")
                return yield* new Graph.FunctionError({
                  graphId: graph.id,
                  reason: "Call has no selected function",
                });
              const capturedInputs = Object.fromEntries(
                [...inputs].map(([id, value]) => [id.slice(3), value]),
              );
              const queueId = FunctionGraph.isQueuedCall(node) ? node.properties.queue : undefined;
              if (
                FunctionGraph.isQueuedCall(node) &&
                (typeof queueId !== "string" || currentProject.queues[queueId] === undefined)
              )
                return yield* new Graph.FunctionError({
                  graphId: graph.id,
                  reason: "Add to Queue has a missing queue target",
                });
              const result =
                typeof queueId === "string"
                  ? options?.queueInvocation === undefined
                    ? yield* new Graph.FunctionError({
                        graphId: graph.id,
                        reason: "Queue invocation is not hosted",
                      })
                    : yield* options.queueInvocation({
                        key: {
                          projectId,
                          graphId: graph.id,
                          eventNodeId: rootEventNodeId ?? eventNode.id,
                          nodeId: node.id,
                          kind: "exec",
                          executionPath,
                          executionTraceId,
                          traceId,
                          ...(parentTraceId === undefined ? {} : { parentTraceId }),
                        },
                        functionId: target,
                        inputs: capturedInputs,
                        queueId,
                        queueLineage: invocation?.options?.queueLineage ?? [],
                      })
                  : yield* invoke(
                      target,
                      capturedInputs,
                      callStack,
                      `${executionPath}/call:${encodeURIComponent(node.id)}:${encodeURIComponent(target)}`,
                      executionTraceId,
                      rootEventNodeId ?? eventNode.id,
                    );
              for (const [id, value] of Object.entries(result))
                outputs.push({ outputId: `out:${id}`, value });
            }
            return { outputs, executionOutputId: node.schema.schema === "output" ? null : "exec" };
          }
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
                engine: registeredPlugin?.engineClient,
                execution: {
                  projectId,
                  graphId: graph.id,
                  eventNodeId: rootEventNodeId ?? eventNode.id,
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
              Effect.catchTag(
                "SchemaError",
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
          // Calls orchestrate child steps inline, never inside another durable task.
          schema.type === "pure" || FunctionGraph.isFunctionNode(node)
            ? yield* execute
            : yield* executionDriver
                .executeNode(
                  {
                    projectId,
                    graphId: graph.id,
                    eventNodeId: rootEventNodeId ?? eventNode.id,
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
                        Schema.encodeUnknownEffect(DataType.JsonValueSchema(type))(value),
                      ),
                    ),
                  ),
                )
                .pipe(
                  Effect.flatMap((result) =>
                    transformResult(result, (type, value) =>
                      Schema.decodeUnknownEffect(DataType.JsonValueSchema(type))(value),
                    ),
                  ),
                );

        for (const output of result.outputs) {
          const ports = nodeIO.dataOutputs.filter((port) => port.id === output.outputId);
          if (
            ports.length !== 1 ||
            nodeIO.executionOutputs.some((port) => port.id === output.outputId) ||
            !DataType.isValue(ports[0]!.type, output.value)
          ) {
            return yield* new InvalidOutputValue({
              nodeId: node.id,
              outputId: output.outputId,
              reason: `Expected ${ports[0]?.type._tag ?? "a declared data output"}`,
            });
          }
          state.outputs.set(outputKey(node.id, output.outputId), output.value);
        }
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
            return yield* Schema.decodeUnknownEffect(DataType.JsonValueSchema(input.type))(
              node.inputDefaults[input.id],
            ).pipe(
              Effect.catchTag(
                "SchemaError",
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
            if (DataType.isValue(input.type, input.defaultValue)) return input.defaultValue;
            return yield* new InvalidInputValue({
              nodeId: node.id,
              inputId: input.id,
              reason: `Declaration default does not match ${input.type._tag}`,
            });
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
        const sourceSchema = yield* getSchema(registeredPlugins, sourceNode, currentProject, graph);
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
        if (!DataType.isValue(input.type, value))
          return yield* new InvalidInputValue({
            nodeId: node.id,
            inputId: input.id,
            reason: `Connected value does not match ${input.type._tag}`,
          });
        return value;
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
            const nextSchema = yield* getSchema(registeredPlugins, nextNode, currentProject, graph);
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

      const executionPath = invocationPath ?? `event:${eventNode.id}`;
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
      if (functionInputs !== undefined && functionResult === undefined)
        return yield* new Graph.FunctionError({
          graphId: graph.id,
          reason: "Function execution did not reach its Output boundary",
        });
      return functionResult ?? {};
    });

    const invoke = Effect.fnUntraced(function* (
      graphId: string,
      inputs: Readonly<Record<string, unknown>>,
      stack: ReadonlyArray<string>,
      invocationPath = `function:${encodeURIComponent(graphId)}`,
      executionTraceId?: string,
      eventNodeId?: string,
    ): Effect.fn.Return<Readonly<Record<string, unknown>>, ExecutorError> {
      const graph = currentProject.graphs[graphId];
      if (graph?.kind !== "function" || graph.signature === undefined)
        return yield* new Graph.FunctionError({
          graphId,
          reason: "Function does not exist or has no signature",
        });
      if (stack.includes(graphId))
        return yield* new Graph.FunctionError({
          graphId,
          reason: `Recursive function call is not supported: ${[...stack, graphId].join(" -> ")}`,
        });
      const boundaries = Object.values(graph.nodes).filter(FunctionGraph.isBoundary);
      const input = boundaries.filter((node) => node.schema.schema === "input");
      if (
        input.length !== 1 ||
        boundaries.filter((node) => node.schema.schema === "output").length !== 1
      )
        return yield* new Graph.FunctionError({
          graphId,
          reason: "Function requires exactly one Input and one Output boundary",
        });
      const schema = yield* getSchema(registeredPlugins, input[0]!, currentProject, graph);
      return yield* executeEventNode(
        graph,
        input[0]!,
        schema,
        inputs,
        [...stack, graphId],
        invocationPath,
        executionTraceId,
        eventNodeId,
      );
    });

    if (invocation !== undefined)
      return yield* invoke(
        invocation.graphId,
        invocation.inputs,
        [],
        invocation.options?.executionPath,
        invocation.options?.executionTraceId,
        invocation.options?.eventNodeId,
      );
    if (definition === undefined || event === undefined) return {};

    yield* Effect.forEach(
      Object.values(currentProject.graphs).filter((graph) => graph.kind !== "function"),
      (graph) =>
        Effect.forEach(
          Object.values(graph.nodes).filter((node) => node.schema.package === definition.id),
          (node) =>
            Effect.gen(function* () {
              const schema = yield* getSchema(registeredPlugins, node, currentProject, graph);
              if (schema.type !== "event") return;
              const matches = yield* resolveProperties(node, schema).pipe(
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
    return {};
  });

  return {
    project: Ref.get(project),
    loadProject: (nextProject) => Ref.set(project, nextProject),
    plugin: registerPlugin,
    invokeFunction: (graphId, inputs, invocationOptions) =>
      execute(undefined, undefined, {
        graphId,
        inputs,
        ...(invocationOptions === undefined ? {} : { options: invocationOptions }),
      }),
    handleEvent: (plugin, event) => {
      const emittedEvent: { readonly _tag: string } = event;
      return execute(plugin, emittedEvent).pipe(
        Effect.asVoid,
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
