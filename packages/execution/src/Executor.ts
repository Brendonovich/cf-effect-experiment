import { Graph, Node, Project } from "@macrograph/core";
import { Engine, Plugin, Registration } from "@macrograph/plugin";
import { Effect, Ref, Schema } from "effect";

export class PluginNotRegistered extends Schema.TaggedErrorClass<PluginNotRegistered>()(
  "PluginNotRegistered",
  { pluginId: Schema.String },
) {}

export class SchemaNotRegistered extends Schema.TaggedErrorClass<SchemaNotRegistered>()(
  "SchemaNotRegistered",
  { pluginId: Schema.String, schemaId: Schema.String },
) {}

export class InvalidConnection extends Schema.TaggedErrorClass<InvalidConnection>()(
  "InvalidConnection",
  { connectionId: Schema.String, reason: Schema.String },
) {}

export class MissingInput extends Schema.TaggedErrorClass<MissingInput>()("MissingInput", {
  nodeId: Schema.String,
  inputId: Schema.String,
}) {}

export class MissingOutput extends Schema.TaggedErrorClass<MissingOutput>()("MissingOutput", {
  nodeId: Schema.String,
  outputId: Schema.String,
}) {}

export class ExecutionCycle extends Schema.TaggedErrorClass<ExecutionCycle>()("ExecutionCycle", {
  nodeId: Schema.String,
}) {}

export type ExecutorError =
  | PluginNotRegistered
  | SchemaNotRegistered
  | InvalidConnection
  | MissingInput
  | MissingOutput
  | ExecutionCycle
  | Node.NotFoundError;

interface RegisteredPlugin {
  readonly schemas: ReadonlyMap<string, Registration.RegisteredSchema>;
}

interface ExecutionState {
  readonly outputs: Map<string, unknown>;
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
  readonly graphId: string;
  readonly eventNodeId: string;
  readonly nodeId: string;
  readonly kind: "event" | "exec";
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
    effect: Effect.Effect<NodeExecutionResult>,
  ) => Effect.Effect<NodeExecutionResult>;
}

export interface MakeOptions {
  readonly executionDriver?: ExecutionDriver;
}

export const inlineExecutionDriver: ExecutionDriver = {
  executeNode: (_key, effect) => effect,
};

const outputKey = (nodeId: string, outputId: string) => `${nodeId}\0${outputId}`;

export const make = Effect.fnUntraced(function* (
  initialProject: Project.Model,
  options?: MakeOptions,
): Effect.fn.Return<Service> {
  const project = yield* Ref.make(initialProject);
  const plugins = yield* Ref.make<ReadonlyMap<string, RegisteredPlugin>>(new Map());
  const executionDriver = options?.executionDriver ?? inlineExecutionDriver;

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
    yield* Ref.update(plugins, (current) => {
      const next = new Map(current);
      next.set(definition.id, {
        schemas: new Map(registered.map((schema) => [schema.id, schema])),
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
    const registeredPlugins = yield* Ref.get(plugins);
    if (!registeredPlugins.has(definition.id))
      return yield* new PluginNotRegistered({ pluginId: definition.id });

    const executeEventNode = Effect.fnUntraced(function* (
      graph: Graph.Model,
      eventNode: Node.Model,
      eventSchema: Registration.RegisteredSchema,
    ): Effect.fn.Return<void, ExecutorError> {
      const state: ExecutionState = {
        outputs: new Map(),
        completedPureNodes: new Set(),
        runningPureNodes: new Set(),
      };

      const runNode = Effect.fnUntraced(function* (
        node: Node.Model,
        schema: Registration.RegisteredSchema,
      ): Effect.fn.Return<string | null, ExecutorError> {
        const inputs = new Map<string, unknown>();
        yield* Effect.forEach(
          schema.dataInputs,
          (input) =>
            resolveInput(node, input).pipe(
              Effect.tap((value) =>
                Effect.sync(() => {
                  inputs.set(input.id, value);
                }),
              ),
            ),
          { discard: true },
        );

        const execute = Effect.gen(function* () {
          const outputs: Array<NodeOutput> = [];
          const selected = selectOutput(
            schema,
            yield* schema.run({
              input: (input) => inputs.get(input.id),
              output: (output, value) => {
                outputs.push({ outputId: output.id, value });
              },
              properties: node.properties,
              event,
            }),
          );
          return {
            outputs,
            executionOutputId: selected?.id ?? null,
          } satisfies NodeExecutionResult;
        });
        const result =
          schema.type === "pure"
            ? yield* execute
            : yield* executionDriver.executeNode(
                {
                  graphId: graph.id,
                  eventNodeId: eventNode.id,
                  nodeId: node.id,
                  kind: schema.type,
                },
                execute,
              );

        for (const output of result.outputs)
          state.outputs.set(outputKey(node.id, output.outputId), output.value);
        return result.executionOutputId;
      });

      const runPureNode = Effect.fnUntraced(function* (
        node: Node.Model,
        schema: Registration.RegisteredSchema,
      ): Effect.fn.Return<void, ExecutorError> {
        if (state.completedPureNodes.has(node.id)) return;
        if (state.runningPureNodes.has(node.id))
          return yield* new ExecutionCycle({ nodeId: node.id });
        state.runningPureNodes.add(node.id);
        yield* runNode(node, schema);
        state.runningPureNodes.delete(node.id);
        state.completedPureNodes.add(node.id);
      });

      const resolveInput = Effect.fnUntraced(function* (
        node: Node.Model,
        input: Registration.DataInputRef,
      ): Effect.fn.Return<unknown, ExecutorError> {
        const connection = graph.connections.find(
          (candidate) => candidate.inNodeId === node.id && candidate.inIoId === input.id,
        );
        if (connection === undefined) {
          if (Object.hasOwn(node.properties, input.id)) return node.properties[input.id];
          if (input.defaultValue !== undefined) return input.defaultValue;
          return yield* new MissingInput({ nodeId: node.id, inputId: input.id });
        }

        const sourceNode = yield* Graph.getNode(graph, connection.outNodeId);
        const sourceSchema = yield* getSchema(registeredPlugins, sourceNode);
        if (!sourceSchema.dataOutputs.some((output) => output.id === connection.outIoId))
          return yield* new InvalidConnection({
            connectionId: connection.id,
            reason: `Output ${connection.outIoId} is not a data output`,
          });
        if (sourceSchema.type === "pure") yield* runPureNode(sourceNode, sourceSchema);

        const key = outputKey(sourceNode.id, connection.outIoId);
        if (!state.outputs.has(key))
          return yield* new MissingOutput({
            nodeId: sourceNode.id,
            outputId: connection.outIoId,
          });
        return state.outputs.get(key);
      });

      const selectOutput = (
        schema: Registration.RegisteredSchema,
        selected: void | Registration.ExecutionOutputRef,
      ) =>
        selected ??
        schema.executionOutputs.find((output) => output.id === "exec") ??
        (schema.executionOutputs.length === 1 ? schema.executionOutputs[0] : undefined);

      let currentNode = eventNode;
      let currentSchema = eventSchema;
      let selectedOutputId = yield* runNode(currentNode, currentSchema);
      const executed = new Set<string>([eventNode.id]);

      while (selectedOutputId !== null) {
        const outputId = selectedOutputId;
        const connection = graph.connections.find(
          (candidate) => candidate.outNodeId === currentNode.id && candidate.outIoId === outputId,
        );
        if (connection === undefined) break;

        const nextNode = yield* Graph.getNode(graph, connection.inNodeId);
        if (executed.has(nextNode.id)) return yield* new ExecutionCycle({ nodeId: nextNode.id });
        const nextSchema = yield* getSchema(registeredPlugins, nextNode);
        if (nextSchema.type !== "exec")
          return yield* new InvalidConnection({
            connectionId: connection.id,
            reason: `Execution flow cannot target a ${nextSchema.type} schema`,
          });
        if (!nextSchema.executionInputs.some((input) => input.id === connection.inIoId))
          return yield* new InvalidConnection({
            connectionId: connection.id,
            reason: `Input ${connection.inIoId} is not an execution input`,
          });

        state.completedPureNodes.clear();
        state.runningPureNodes.clear();
        executed.add(nextNode.id);
        currentNode = nextNode;
        currentSchema = nextSchema;
        selectedOutputId = yield* runNode(currentNode, currentSchema);
      }
    });

    yield* Effect.forEach(
      Object.values(currentProject.graphs),
      (graph) =>
        Effect.forEach(
          Object.values(graph.nodes).filter((node) => node.schema.package === definition.id),
          (node) =>
            Effect.gen(function* () {
              const schema = yield* getSchema(registeredPlugins, node);
              if (schema.type !== "event") return;
              const matches = yield* schema.matches(event, node.properties);
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
    handleEvent,
  };
});

export * as Executor from "./Executor.ts";
