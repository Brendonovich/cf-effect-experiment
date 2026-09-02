import type * as Engine from "@macrograph/plugin/Engine";
import type * as Plugin from "@macrograph/plugin/Plugin";

import {
  Clipboard,
  Connection,
  Graph,
  GraphId,
  IoId,
  Node,
  NodeId,
  NodeIO,
  Package,
  PackageId,
  Project,
  RenderedProject,
  ResourceConstant,
  SchemaId,
} from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { DataType } from "@macrograph/plugin/DataType";
import * as HttpEndpoint from "@macrograph/plugin/HttpEndpoint";
import * as Registration from "@macrograph/plugin/Registration";
import { Context, Effect, Fiber, Layer, Ref, Schema, Semaphore, Stream } from "effect";

import { EditorEvent } from "./EditorEvent.ts";
import { EditorEvents } from "./EditorEvents.ts";
import { Packages } from "./Packages.ts";

const ResourceKey = Schema.String.pipe(Schema.brand("ResourceKey"));
type ResourceKey = typeof ResourceKey.Type;

type GraphUpdateOptions = {
  readonly graphID: string;
  readonly name: string;
};

type NodeCreateOptions = {
  readonly graphID: string;
  readonly node: Node.CreateInput;
};

type NodeUpdateOptions = {
  readonly graphID: string;
  readonly nodeID: string;
  readonly name?: string;
  readonly position?: { readonly x: number; readonly y: number };
  readonly ephemeral?: boolean;
};

type NodeDeleteOptions = {
  readonly graphID: string;
  readonly nodeID: string;
};

type NodeSetPropertyOptions = {
  readonly graphID: string;
  readonly nodeID: string;
  readonly property: string;
  readonly value: unknown;
};

type NodePropertyOptions = Omit<NodeSetPropertyOptions, "value">;

type NodeInputOptions = {
  readonly graphID: string;
  readonly nodeID: string;
  readonly input: string;
};

type NodeSetInputDefaultOptions = NodeInputOptions & { readonly value: unknown };

type NodeSetFoldPinsOptions = {
  readonly graphID: string;
  readonly nodeID: string;
  readonly foldPins: boolean;
};

export const ProjectSnapshot = Schema.Struct({
  project: Project.Model,
  nodeIO: Schema.Record(Schema.String, Schema.Record(Schema.String, NodeIO)),
});
export type ProjectSnapshot = typeof ProjectSnapshot.Type;

type NodeMutationError =
  | PersistenceError
  | Project.NotFoundError
  | Graph.NotFoundError
  | Node.NotFoundError;

export class EngineNotRegistered extends Schema.TaggedError<EngineNotRegistered>()(
  "EngineNotRegistered",
  { pluginId: Schema.String },
) {}

export class EngineNotHosted extends Schema.TaggedError<EngineNotHosted>()("EngineNotHosted", {
  pluginId: Schema.String,
}) {}

export class InvalidEngineState extends Schema.TaggedError<InvalidEngineState>()(
  "InvalidEngineState",
  { pluginId: Schema.String, cause: Schema.Unknown },
) {}

export interface HostedResource {
  readonly values: Effect.Effect<ReadonlyArray<ResourceConstant.LiveValue>>;
  readonly reload: Effect.Effect<void>;
  readonly changes: Stream.Stream<ReadonlyArray<ResourceConstant.LiveValue>>;
}

export interface Interface {
  readonly fragment: {
    readonly identity: () => Effect.Effect<string>;
    readonly paste: (options: {
      readonly graphID: string;
      readonly text: string;
      readonly position: { readonly x: number; readonly y: number };
      readonly bindings?: ReadonlyArray<Clipboard.Binding>;
      readonly forceMissingSchemas?: boolean;
    }) => Effect.Effect<
      EditorEvent.FragmentPasted,
      | PersistenceError
      | Graph.NotFoundError
      | Project.NotFoundError
      | Clipboard.InvalidError
      | Clipboard.RebindRequired
      | Clipboard.MissingSchemas
    >;
    readonly delete: (options: {
      readonly graphID: string;
      readonly nodeIds: ReadonlyArray<string>;
    }) => Effect.Effect<EditorEvent.FragmentDeleted, NodeMutationError | Clipboard.InvalidError>;
  };
  readonly project: {
    readonly get: () => Effect.Effect<Project.Model, Project.NotFoundError | PersistenceError>;
    readonly snapshot: () => Effect.Effect<
      ProjectSnapshot,
      Project.NotFoundError | PersistenceError
    >;
    readonly rendered: () => Effect.Effect<
      RenderedProject.Model,
      Project.NotFoundError | PersistenceError | Package.SchemaNotFoundError
    >;
  };
  readonly constant: {
    readonly create: (
      resource: ResourceConstant.ResourceRef,
    ) => Effect.Effect<
      EditorEvent.ResourceConstantCreated,
      PersistenceError | Project.NotFoundError | ResourceConstant.InvalidResourceError
    >;
    readonly rename: (
      id: string,
      name: string,
    ) => Effect.Effect<
      EditorEvent.ResourceConstantUpdated,
      PersistenceError | Project.NotFoundError | ResourceConstant.NotFoundError
    >;
    readonly select: (
      id: string,
      value: Schema.Json,
    ) => Effect.Effect<
      EditorEvent.ResourceConstantUpdated,
      | PersistenceError
      | Project.NotFoundError
      | ResourceConstant.NotFoundError
      | ResourceConstant.InvalidResourceError
    >;
    readonly delete: (
      id: string,
    ) => Effect.Effect<
      EditorEvent.ResourceConstantDeleted,
      | PersistenceError
      | Project.NotFoundError
      | ResourceConstant.NotFoundError
      | ResourceConstant.InUseError
    >;
    readonly setDefault: (
      id: string,
    ) => Effect.Effect<
      EditorEvent.ResourceConstantDefaultChanged,
      PersistenceError | Project.NotFoundError | ResourceConstant.NotFoundError
    >;
  };
  readonly graph: {
    readonly create: (
      graph: Graph.CreateInput,
    ) => Effect.Effect<EditorEvent.GraphCreated, PersistenceError>;
    readonly update: (
      options: GraphUpdateOptions,
    ) => Effect.Effect<EditorEvent.GraphNameChanged, PersistenceError | Graph.NotFoundError>;
    readonly delete: (options: {
      readonly graphID: string;
    }) => Effect.Effect<EditorEvent.GraphDeleted, PersistenceError>;
  };
  readonly node: {
    readonly create: (
      options: NodeCreateOptions,
    ) => Effect.Effect<
      EditorEvent.NodeCreated,
      | PersistenceError
      | Project.NotFoundError
      | Graph.NotFoundError
      | Package.SchemaNotFoundError
      | Package.InvalidPropertyError
      | Package.InvalidInputDefaultError
    >;
    readonly update: (options: NodeUpdateOptions) => Effect.Effect<void, NodeMutationError>;
    readonly setFoldPins: (
      options: NodeSetFoldPinsOptions,
    ) => Effect.Effect<EditorEvent.NodeFoldPinsChanged, NodeMutationError>;
    readonly setProperty: (
      options: NodeSetPropertyOptions,
    ) => Effect.Effect<
      EditorEvent.NodePropertyUpdated,
      NodeMutationError | Package.SchemaNotFoundError | Package.InvalidPropertyError
    >;
    readonly clearProperty: (
      options: NodePropertyOptions,
    ) => Effect.Effect<
      EditorEvent.NodePropertyUpdated,
      NodeMutationError | Package.SchemaNotFoundError | Package.InvalidPropertyError
    >;
    readonly setInputDefault: (
      options: NodeSetInputDefaultOptions,
    ) => Effect.Effect<
      EditorEvent.InputDefaultUpdated,
      NodeMutationError | Package.SchemaNotFoundError | Package.InvalidInputDefaultError
    >;
    readonly clearInputDefault: (
      options: NodeInputOptions,
    ) => Effect.Effect<
      EditorEvent.InputDefaultUpdated,
      NodeMutationError | Package.SchemaNotFoundError | Package.InvalidInputDefaultError
    >;
    readonly getInputSuggestions: (
      options: NodeInputOptions,
    ) => Effect.Effect<
      ReadonlyArray<string>,
      NodeMutationError | Package.SchemaNotFoundError | Package.InvalidInputDefaultError
    >;
    readonly delete: (
      options: NodeDeleteOptions,
    ) => Effect.Effect<EditorEvent.NodeDeleted, NodeMutationError>;
  };
  readonly connection: {
    readonly create: (options: {
      readonly graphID: string;
      readonly connection: Connection.CreateInput;
    }) => Effect.Effect<
      EditorEvent.ConnectionCreated,
      | PersistenceError
      | Project.NotFoundError
      | Graph.NotFoundError
      | Node.NotFoundError
      | Package.SchemaNotFoundError
      | Connection.InvalidError
    >;
    readonly delete: (options: {
      readonly graphID: string;
      readonly connectionId: string;
    }) => Effect.Effect<EditorEvent.ConnectionDeleted, PersistenceError>;
  };
  readonly engine: {
    readonly setState: (
      pluginId: string,
      state: unknown,
    ) => Effect.Effect<
      EditorEvent.EngineStateChanged,
      PersistenceError | EngineNotRegistered | InvalidEngineState
    >;
    readonly getEndpoints: () => Effect.Effect<ReadonlyArray<HttpEndpoint.Routed>>;
    readonly setEndpoints: (endpoints: ReadonlyArray<HttpEndpoint.Routed>) => Effect.Effect<void>;
    readonly hostClientState: (
      pluginId: string,
      state: Effect.Effect<Schema.Json>,
    ) => Effect.Effect<void>;
    readonly getClientState: (pluginId: string) => Effect.Effect<Schema.Json, EngineNotHosted>;
    readonly dirtyClientState: (pluginId: string) => Effect.Effect<void>;
    readonly getClientCapabilities: () => Effect.Effect<ReadonlyArray<string>>;
    readonly hostResource: (
      pluginId: string,
      resourceId: string,
      resource: HostedResource,
    ) => Effect.Effect<void>;
    readonly getResourceValues: (
      pluginId: string,
      resourceId: string,
    ) => Effect.Effect<
      ReadonlyArray<ResourceConstant.LiveValue>,
      ResourceConstant.InvalidResourceError
    >;
    readonly reloadResource: (
      pluginId: string,
      resourceId: string,
    ) => Effect.Effect<void, ResourceConstant.InvalidResourceError>;
    readonly hostRuntimeClient: (pluginId: string, client: unknown) => Effect.Effect<void>;
    readonly getRuntimeClient: (pluginId: string) => Effect.Effect<unknown, EngineNotHosted>;
  };
  readonly plugin: <Definition extends Engine.AnyDef = never>(
    ...args: Plugin.RegisterArgs<Definition>
  ) => Effect.Effect<void>;
}

/** Coordinates project editing, resource constants, plugin registration, and hosted engines. */
export class Service extends Context.Service<Service, Interface>()("macrograph/Editor") {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    const scope = yield* Effect.scope;
    const events = yield* EditorEvents.Service;
    const packages = yield* Packages.Service;
    const lock = yield* Semaphore.make(1);
    const clipboardSession = crypto.randomUUID();
    const engines = yield* Ref.make<ReadonlyMap<string, Engine.AnyDef>>(new Map());
    const engineClientStates = yield* Ref.make<ReadonlyMap<string, Effect.Effect<Schema.Json>>>(
      new Map(),
    );
    const engineEndpoints = yield* Ref.make<ReadonlyArray<HttpEndpoint.Routed>>([]);
    const hostedResources = yield* Ref.make<
      ReadonlyMap<ResourceKey, HostedResource & { readonly forwardingFiber: Fiber.Fiber<void> }>
    >(new Map());
    const runtimeClients = yield* Ref.make<ReadonlyMap<string, unknown>>(new Map());
    const resourceKey = (pluginId: string, resourceId: string) =>
      ResourceKey.make(`${pluginId}\0${resourceId}`);
    const resolveIOProperties = Effect.fnUntraced(function* (
      schemaRef: Node.Model["schema"],
      persistedProperties: Readonly<Record<string, Schema.Json>>,
      constants?: Readonly<Record<string, ResourceConstant.Model>>,
    ) {
      const schema = yield* packages.getSchema(schemaRef);
      const properties: Record<string, unknown> = { ...persistedProperties };
      if (schema.properties.some((property) => "resource" in property)) {
        const resourceConstants = constants ?? (yield* persistence.loadProject()).constants;
        for (const property of schema.properties) {
          if (!("resource" in property)) continue;
          const constantId = persistedProperties[property.id];
          const constant =
            typeof constantId === "string" ? resourceConstants[constantId] : undefined;
          if (
            constant?.value !== undefined &&
            constant.resource.package === schemaRef.package &&
            constant.resource.resource === property.resource
          ) {
            properties[property.id] = constant.value;
          }
        }
      }
      return properties;
    });
    const getNodeIO = (node: Node.Model) =>
      resolveIOProperties(node.schema, node.properties).pipe(
        Effect.flatMap((properties) => packages.getNodeIO(node.schema, properties)),
      );
    const retainValidInputDefaults = Effect.fnUntraced(function* (
      io: NodeIO,
      defaults: Readonly<Record<string, Schema.Json>>,
    ) {
      const retained: Record<string, Schema.Json> = {};
      for (const input of Object.keys(defaults).sort()) {
        const ports = io.dataInputs.filter((port) => port.id === input);
        if (ports.length !== 1 || io.executionInputs.some((port) => port.id === input)) continue;
        const valid = yield* Schema.decodeUnknownEffect(DataType.JsonValueSchema(ports[0]!.type))(
          defaults[input],
        ).pipe(
          Effect.as(true),
          Effect.catchTag("SchemaError", () => Effect.succeed(false)),
        );
        if (valid) retained[input] = defaults[input]!;
      }
      return retained;
    });
    const validateResourceBindings = Effect.fnUntraced(function* (
      schemaRef: Node.Model["schema"],
      properties: Readonly<Record<string, Schema.Json>>,
    ) {
      const schema = yield* packages.getSchema(schemaRef);
      const project = yield* persistence.loadProject();
      for (const property of schema.properties) {
        if (!("resource" in property)) continue;
        const constantId = properties[property.id];
        if (constantId === undefined) continue;
        const constant = typeof constantId === "string" ? project.constants[constantId] : undefined;
        if (constant === undefined)
          return yield* new Package.InvalidPropertyError({
            property: property.id,
            reason: "Resource constant does not exist",
          });
        if (
          constant.resource.package !== schemaRef.package ||
          constant.resource.resource !== property.resource
        )
          return yield* new Package.InvalidPropertyError({
            property: property.id,
            reason: "Resource constant has an incompatible resource type",
          });
      }
    });
    const isConnectionValid = (
      connection: Connection.Model | Connection.CreateInput,
      outputIO: NodeIO,
      inputIO: NodeIO,
    ) => {
      const executionOutputs = outputIO.executionOutputs.filter(
        (output) => output.id === connection.outIoId,
      );
      const dataOutputs = outputIO.dataOutputs.filter((output) => output.id === connection.outIoId);
      const executionInputs = inputIO.executionInputs.filter(
        (input) => input.id === connection.inIoId,
      );
      const dataInputs = inputIO.dataInputs.filter((input) => input.id === connection.inIoId);
      if (executionOutputs.length + dataOutputs.length !== 1) return false;
      if (executionInputs.length + dataInputs.length !== 1) return false;
      if ((executionOutputs.length === 1) !== (executionInputs.length === 1)) return false;
      const dataOutput = dataOutputs[0];
      const dataInput = dataInputs[0];
      return dataOutput === undefined || dataInput === undefined
        ? dataOutput === undefined && dataInput === undefined
        : DataType.equals(dataOutput.type, dataInput.type);
    };

    const graphCreate = Effect.fn("Editor.graph.create")(function* (input: Graph.CreateInput) {
      const graphId = GraphId.make(Math.random().toString(36).slice(2));
      const graph: Graph.Model = {
        id: graphId,
        name: input.name ?? "New Graph",
        nodes: input.nodes ?? {},
        connections: input.connections ?? [],
      };
      return yield* events.publish({ _tag: "GraphCreated", graph });
    }, lock.withPermit);

    const graphUpdate = Effect.fn("Editor.graph.update")(function* (options: GraphUpdateOptions) {
      yield* persistence.loadGraph(options.graphID);
      return yield* events.publish({
        _tag: "GraphNameChanged",
        graphId: options.graphID,
        name: options.name,
      });
    }, lock.withPermit);

    const graphDelete = Effect.fn("Editor.graph.delete")(function* (options: {
      readonly graphID: string;
    }) {
      return yield* events.publish({ _tag: "GraphDeleted", graphId: options.graphID });
    }, lock.withPermit);

    const nodeCreate = Effect.fn("Editor.node.create")(function* (options: NodeCreateOptions) {
      yield* persistence.loadGraph(options.graphID);
      const schema = yield* packages.getSchema(options.node.schema);
      const initialProperties = { ...options.node.properties };
      if (schema.properties.some((property) => "resource" in property)) {
        const constants = (yield* persistence.loadProject()).constants;
        for (const property of schema.properties) {
          if (!("resource" in property) || Object.hasOwn(initialProperties, property.id)) continue;
          const constant = ResourceConstant.getDefault(constants, {
            package: options.node.schema.package,
            resource: property.resource,
          });
          if (constant !== undefined) initialProperties[property.id] = constant.id;
        }
      }
      const properties = yield* packages.normalizeProperties(
        options.node.schema,
        initialProperties,
      );
      yield* validateResourceBindings(options.node.schema, properties);
      const inputDefaults: Record<string, Schema.Json> = {};
      const ioProperties = yield* resolveIOProperties(options.node.schema, properties);
      for (const [input, value] of Object.entries(options.node.inputDefaults ?? {})) {
        inputDefaults[input] = yield* packages.validateInputDefault(
          options.node.schema,
          ioProperties,
          input,
          value,
        );
      }
      const nodeId = NodeId.make(Math.random().toString(36).slice(2));
      const node: Node.Model = {
        id: nodeId,
        name: options.node.name ?? schema.name,
        properties,
        inputDefaults,
        foldPins: options.node.foldPins ?? false,
        schema: options.node.schema,
        position: options.node.position ?? { x: 0, y: 0 },
      };
      const io = yield* getNodeIO(node);
      return yield* events.publish({ _tag: "NodeCreated", graphId: options.graphID, node, io });
    }, lock.withPermit);

    const fragmentPaste = Effect.fn("Editor.fragment.paste")(
      function* (options: {
        readonly graphID: string;
        readonly text: string;
        readonly position: { readonly x: number; readonly y: number };
        readonly bindings?: ReadonlyArray<Clipboard.Binding>;
        readonly forceMissingSchemas?: boolean;
      }) {
        const fragment = yield* Clipboard.decode(options.text);
        if (!Clipboard.validPosition(options.position))
          return yield* new Clipboard.InvalidError({ reason: "Invalid paste position" });
        const graph = yield* persistence.loadGraph(options.graphID);
        const project = yield* persistence.loadProject();
        const sameProject = fragment.source?.session === clipboardSession;
        const requests: Array<Clipboard.RebindRequest> = [];
        const resolved: Array<Node.Model> = [];
        const missingNodeIds = new Set<string>();
        const missingSchemas = new Map<string, Clipboard.MissingSchema>();
        if ((options.bindings?.length ?? 0) > Clipboard.maxNodes * 20)
          return yield* new Clipboard.InvalidError({ reason: "Too many rebindings" });
        for (const original of fragment.nodes) {
          const source = original;
          const schema = yield* packages
            .getSchema(source.schema)
            .pipe(Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(undefined)));
          if (schema?.internal === true)
            return yield* new Clipboard.InvalidError({
              reason: `${source.name}: system-created nodes cannot be pasted`,
            });
          if (schema === undefined) {
            const key = JSON.stringify([source.schema.package, source.schema.schema]);
            missingSchemas.set(key, source.schema);
            if (!options.forceMissingSchemas) continue;
            missingNodeIds.add(source.id);
            resolved.push(source);
            continue;
          }
          const properties = { ...source.properties };
          for (const definition of schema.properties) {
            if (!("resource" in definition) || !Object.hasOwn(properties, definition.id)) continue;
            const value = properties[definition.id];
            const candidates = Object.values(project.constants).filter(
              (constant) =>
                constant.resource.package === source.schema.package &&
                constant.resource.resource === definition.resource,
            );
            const binding = options.bindings?.find(
              (binding) => binding.nodeId === source.id && binding.property === definition.id,
            );
            const target = candidates.find((constant) => constant.id === binding?.target);
            if (binding && !target)
              return yield* new Clipboard.InvalidError({
                reason: "Resource rebind target is unavailable or incompatible",
              });
            if (target) properties[definition.id] = target.id;
            else if (!sameProject || !candidates.some((constant) => constant.id === value))
              requests.push({
                nodeId: source.id,
                property: definition.id,
                label: `${source.name}: ${definition.name} (${String(value)})`,
                kind: "resource",
                candidates: candidates.map((constant) => ({
                  id: constant.id,
                  name: constant.name,
                })),
              });
          }
          resolved.push({ ...source, properties });
        }
        if (missingSchemas.size > 0 && !options.forceMissingSchemas)
          return yield* new Clipboard.MissingSchemas({ schemas: [...missingSchemas.values()] });
        if (requests.length > 0) return yield* new Clipboard.RebindRequired({ requests });
        const nodes: Array<Node.Model> = [];
        const nodeIO: Record<string, NodeIO> = {};
        const remap = new Map<string, NodeId>();
        const anchor = {
          x: Math.min(...fragment.nodes.map((node) => node.position.x)),
          y: Math.min(...fragment.nodes.map((node) => node.position.y)),
        };
        for (const source of resolved) {
          if (missingNodeIds.has(source.id)) {
            let id = NodeId.make(crypto.randomUUID());
            while (Object.hasOwn(graph.nodes, id) || nodes.some((node) => node.id === id))
              id = NodeId.make(crypto.randomUUID());
            const position = {
              x: options.position.x + source.position.x - anchor.x,
              y: options.position.y + source.position.y - anchor.y,
            };
            if (!Clipboard.validPosition(position))
              return yield* new Clipboard.InvalidError({
                reason: "Pasted position exceeds limits",
              });
            const node = { ...source, id, position };
            nodes.push(node);
            remap.set(source.id, node.id);
            const capturedIO = fragment.nodeIO?.[source.id];
            if (capturedIO !== undefined) nodeIO[node.id] = capturedIO;
            continue;
          }
          const node = yield* Effect.gen(function* () {
            const schema = yield* packages.getSchema(source.schema);
            if (schema.internal === true)
              return yield* new Clipboard.InvalidError({
                reason: `${source.name}: system-created nodes cannot be pasted`,
              });
            for (const property of Object.keys(source.properties)) {
              const definition = schema.properties.find((candidate) => candidate.id === property);
              if (definition === undefined)
                return yield* new Clipboard.InvalidError({
                  reason: `${source.name}: undeclared property ${property}`,
                });
            }
            const properties = yield* packages.normalizeProperties(
              source.schema,
              source.properties,
            );
            yield* validateResourceBindings(source.schema, properties);
            const ioProperties = yield* resolveIOProperties(source.schema, properties);
            const inputDefaults: Record<string, Schema.Json> = {};
            for (const [input, value] of Object.entries(source.inputDefaults))
              inputDefaults[input] = yield* packages.validateInputDefault(
                source.schema,
                ioProperties,
                input,
                value,
              );
            let id = NodeId.make(crypto.randomUUID());
            while (Object.hasOwn(graph.nodes, id) || nodes.some((node) => node.id === id))
              id = NodeId.make(crypto.randomUUID());
            const position = {
              x: options.position.x + source.position.x - anchor.x,
              y: options.position.y + source.position.y - anchor.y,
            };
            if (!Clipboard.validPosition(position))
              return yield* new Clipboard.InvalidError({
                reason: "Pasted position exceeds limits",
              });
            const node: Node.Model = { ...source, id, properties, inputDefaults, position };
            nodeIO[id] = yield* getNodeIO(node);
            return node;
          }).pipe(
            Effect.catchTags({
              SchemaNotFoundError: () =>
                new Clipboard.InvalidError({
                  reason: `${source.name}: schema ${source.schema.package}/${source.schema.schema} is unavailable; definitions are not imported`,
                }),
              InvalidPropertyError: (error) =>
                new Clipboard.InvalidError({
                  reason: `${source.name}: ${error.property}: ${error.reason}`,
                }),
              InvalidInputDefaultError: (error) =>
                new Clipboard.InvalidError({
                  reason: `${source.name}: ${error.input}: ${error.reason}`,
                }),
            }),
          );
          nodes.push(node);
          remap.set(source.id, node.id);
        }
        const connections: Array<Connection.Model> = [];
        const connectionIds = new Set(graph.connections.map((connection) => connection.id));
        const external =
          sameProject && fragment.source?.graphId === options.graphID
            ? (fragment.externalConnections ?? [])
            : [];
        const occupied = new Set(
          graph.connections.map((connection) =>
            JSON.stringify([connection.inNodeId, connection.inIoId]),
          ),
        );
        for (const original of [...fragment.connections, ...external]) {
          const isExternal = external.includes(original);
          const outNodeId = remap.get(original.outNodeId) ?? original.outNodeId;
          const inNodeId = remap.get(original.inNodeId) ?? original.inNodeId;
          const outputIO =
            nodeIO[outNodeId] ??
            (Object.hasOwn(graph.nodes, outNodeId)
              ? yield* getNodeIO(graph.nodes[outNodeId]!).pipe(
                  Effect.catchCause(() => Effect.succeed(undefined)),
                )
              : undefined);
          const inputIO =
            nodeIO[inNodeId] ??
            (Object.hasOwn(graph.nodes, inNodeId)
              ? yield* getNodeIO(graph.nodes[inNodeId]!).pipe(
                  Effect.catchCause(() => Effect.succeed(undefined)),
                )
              : undefined);
          if (outputIO === undefined || inputIO === undefined) {
            if (isExternal) continue;
            return yield* new Clipboard.InvalidError({
              reason: `Connection ${original.id}: unavailable schema IO was not copied`,
            });
          }
          const source = original;
          const inputKey = JSON.stringify([inNodeId, source.inIoId]);
          if (
            isExternal &&
            (occupied.has(inputKey) || !isConnectionValid(source, outputIO, inputIO))
          )
            continue;
          if (occupied.has(inputKey) || !isConnectionValid(source, outputIO, inputIO))
            return yield* new Clipboard.InvalidError({
              reason: `Connection ${source.id}: missing, ambiguous or incompatible ports`,
            });
          let id = Connection.ConnectionId.make(crypto.randomUUID());
          while (connectionIds.has(id)) id = Connection.ConnectionId.make(crypto.randomUUID());
          connectionIds.add(id);
          connections.push({ ...source, id, outNodeId, inNodeId });
          occupied.add(inputKey);
        }
        return yield* events.publish({
          _tag: "FragmentPasted",
          graphId: options.graphID,
          nodes,
          connections,
          nodeIO,
        });
      },
      lock.withPermit,
      Effect.catchDefect(
        () =>
          new Clipboard.InvalidError({
            reason: "Destination schema could not validate this fragment; nothing was pasted",
          }),
      ),
    );

    const fragmentDelete = Effect.fn("Editor.fragment.delete")(function* (options: {
      readonly graphID: string;
      readonly nodeIds: ReadonlyArray<string>;
    }) {
      if (
        options.nodeIds.length === 0 ||
        options.nodeIds.length > Clipboard.maxNodes ||
        new Set(options.nodeIds).size !== options.nodeIds.length
      )
        return yield* new Clipboard.InvalidError({ reason: "Invalid cut selection" });
      const graph = yield* persistence.loadGraph(options.graphID);
      for (const id of options.nodeIds) {
        if (!Object.hasOwn(graph.nodes, id)) return yield* new Node.NotFoundError({ id });
        const node = yield* Graph.getNode(graph, id);
        const schema = yield* packages.getSchema(node.schema).pipe(
          Effect.catchTag(
            "SchemaNotFoundError",
            () =>
              new Clipboard.InvalidError({
                reason: `${node.name}: cannot cut an unavailable schema`,
              }),
          ),
        );
        if (schema.internal === true)
          return yield* new Clipboard.InvalidError({
            reason: `${node.name}: system-created nodes cannot be cut`,
          });
      }
      const selected = new Set(options.nodeIds);
      return yield* events.publish({
        _tag: "FragmentDeleted",
        graphId: options.graphID,
        nodeIds: options.nodeIds,
        deletedConnectionIds: graph.connections
          .filter(
            (connection) => selected.has(connection.inNodeId) || selected.has(connection.outNodeId),
          )
          .map((connection) => connection.id),
      });
    }, lock.withPermit);

    const nodeUpdate = Effect.fn("Editor.node.update")(function* (options: NodeUpdateOptions) {
      const graph = yield* persistence.loadGraph(options.graphID);
      yield* Graph.getNode(graph, options.nodeID);

      if (options.name !== undefined) {
        yield* events.publish({
          _tag: "NodeNameChanged",
          graphId: options.graphID,
          nodeId: options.nodeID,
          name: options.name,
        });
      }

      if (options.position !== undefined) {
        const event = {
          _tag: "NodePositionChanged" as const,
          graphId: options.graphID,
          nodeId: options.nodeID,
          x: options.position.x,
          y: options.position.y,
        };
        yield* options.ephemeral ? events.publishEphemeral(event) : events.publish(event);
      }
    }, lock.withPermit);

    const nodeDelete = Effect.fn("Editor.node.delete")(function* (options: NodeDeleteOptions) {
      const graph = yield* persistence.loadGraph(options.graphID);
      yield* Graph.getNode(graph, options.nodeID);
      const connections = graph.connections
        .filter(
          (connection) =>
            connection.inNodeId === options.nodeID || connection.outNodeId === options.nodeID,
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      return yield* events.publish({
        _tag: "NodeDeleted",
        graphId: options.graphID,
        nodeId: options.nodeID,
        deletedConnectionIds: connections.map((connection) => connection.id),
      });
    }, lock.withPermit);

    const nodeSetFoldPins = Effect.fn("Editor.node.setFoldPins")(function* (
      options: NodeSetFoldPinsOptions,
    ) {
      const graph = yield* persistence.loadGraph(options.graphID);
      yield* Graph.getNode(graph, options.nodeID);
      return yield* events.publish({
        _tag: "NodeFoldPinsChanged",
        graphId: options.graphID,
        nodeId: options.nodeID,
        foldPins: options.foldPins,
      });
    }, lock.withPermit);

    const mutateNodeProperty = Effect.fn("Editor.node.mutateProperty")(function* (
      options: NodePropertyOptions & { readonly value?: unknown; readonly clear: boolean },
    ) {
      const graph = yield* persistence.loadGraph(options.graphID);
      const node = yield* Graph.getNode(graph, options.nodeID);
      if (options.clear) {
        const schema = yield* packages.getSchema(node.schema);
        if (
          schema.properties.length > 0 &&
          !schema.properties.some((property) => property.id === options.property)
        ) {
          return yield* new Package.InvalidPropertyError({
            property: options.property,
            reason: "Property is not declared by the schema",
          });
        }
      }
      const candidate: Record<string, unknown> = { ...node.properties };
      if (options.clear) delete candidate[options.property];
      else candidate[options.property] = options.value;
      const properties = yield* packages.normalizeProperties(node.schema, candidate);
      yield* validateResourceBindings(node.schema, properties);
      const updated: Node.Model = {
        ...node,
        properties,
      };
      const io = yield* getNodeIO(updated);
      const inputDefaults = yield* retainValidInputDefaults(io, node.inputDefaults);

      const stale: Array<Connection.Model> = [];
      for (const connection of graph.connections) {
        if (connection.inNodeId !== node.id && connection.outNodeId !== node.id) continue;
        const outputNode = graph.nodes[connection.outNodeId];
        const inputNode = graph.nodes[connection.inNodeId];
        if (outputNode === undefined || inputNode === undefined) {
          stale.push(connection);
          continue;
        }
        const outputIO = outputNode.id === node.id ? io : yield* getNodeIO(outputNode);
        const inputIO = inputNode.id === node.id ? io : yield* getNodeIO(inputNode);
        if (!isConnectionValid(connection, outputIO, inputIO)) stale.push(connection);
      }
      return yield* events.publish({
        _tag: "NodePropertyUpdated",
        graphId: options.graphID,
        nodeId: options.nodeID,
        property: options.property,
        properties,
        inputDefaults,
        deletedConnectionIds: stale
          .map((connection) => connection.id)
          .sort((left, right) => left.localeCompare(right)),
        io,
      });
    }, lock.withPermit);

    const nodeSetProperty = (options: NodeSetPropertyOptions) =>
      mutateNodeProperty({ ...options, clear: false });

    const nodeClearProperty = (options: NodePropertyOptions) =>
      mutateNodeProperty({ ...options, clear: true });

    const nodeSetInputDefault = Effect.fn("Editor.node.setInputDefault")(function* (
      options: NodeSetInputDefaultOptions,
    ) {
      const graph = yield* persistence.loadGraph(options.graphID);
      const node = yield* Graph.getNode(graph, options.nodeID);
      const ioProperties = yield* resolveIOProperties(node.schema, node.properties);
      const value = yield* packages.validateInputDefault(
        node.schema,
        ioProperties,
        options.input,
        options.value,
      );
      return yield* events.publish({
        _tag: "InputDefaultUpdated",
        graphId: options.graphID,
        nodeId: options.nodeID,
        input: options.input,
        inputDefaults: { ...node.inputDefaults, [options.input]: value },
      });
    }, lock.withPermit);

    const nodeClearInputDefault = Effect.fn("Editor.node.clearInputDefault")(function* (
      options: NodeInputOptions,
    ) {
      const graph = yield* persistence.loadGraph(options.graphID);
      const node = yield* Graph.getNode(graph, options.nodeID);
      const io = yield* getNodeIO(node);
      if (
        io.dataInputs.filter((port) => port.id === options.input).length !== 1 ||
        io.executionInputs.some((port) => port.id === options.input)
      ) {
        return yield* new Package.InvalidInputDefaultError({
          input: options.input,
          reason: "Input is not an unambiguous data input",
        });
      }
      const inputDefaults = { ...node.inputDefaults };
      delete inputDefaults[options.input];
      return yield* events.publish({
        _tag: "InputDefaultUpdated",
        graphId: options.graphID,
        nodeId: options.nodeID,
        input: options.input,
        inputDefaults,
      });
    }, lock.withPermit);

    const nodeGetInputSuggestions = Effect.fn("Editor.node.getInputSuggestions")(function* (
      options: NodeInputOptions,
    ) {
      const { node, properties } = yield* Effect.gen(function* () {
        const graph = yield* persistence.loadGraph(options.graphID);
        const node = yield* Graph.getNode(graph, options.nodeID);
        const properties = yield* resolveIOProperties(node.schema, node.properties);
        return { node, properties };
      }).pipe(lock.withPermit);
      // Live resolvers can update engine storage, which also acquires the editor lock.
      return yield* packages.getSuggestions(
        node.schema,
        properties,
        node.inputDefaults,
        options.input,
      );
    });

    const connectionCreate = Effect.fn("Editor.connection.create")(function* (options: {
      readonly graphID: string;
      readonly connection: Connection.CreateInput;
    }) {
      const graph = yield* persistence.loadGraph(options.graphID);
      const outNode = yield* Graph.getNode(graph, options.connection.outNodeId);
      const inNode = yield* Graph.getNode(graph, options.connection.inNodeId);
      const outSchema = yield* getNodeIO(outNode);
      const inSchema = yield* getNodeIO(inNode);

      const executionOutputs = outSchema.executionOutputs.filter(
        (output) => output.id === options.connection.outIoId,
      );
      const dataOutputs = outSchema.dataOutputs.filter(
        (output) => output.id === options.connection.outIoId,
      );
      const executionInputs = inSchema.executionInputs.filter(
        (input) => input.id === options.connection.inIoId,
      );
      const dataInputs = inSchema.dataInputs.filter(
        (input) => input.id === options.connection.inIoId,
      );
      const outputKinds = executionOutputs.length + dataOutputs.length;
      const inputKinds = executionInputs.length + dataInputs.length;

      if (outputKinds !== 1)
        return yield* new Connection.InvalidError({
          reason: "Output does not identify one IO kind",
        });
      if (inputKinds !== 1)
        return yield* new Connection.InvalidError({
          reason: "Input does not identify one IO kind",
        });
      if ((executionOutputs.length === 0) !== (executionInputs.length === 0))
        return yield* new Connection.InvalidError({
          reason: "Connection endpoints must have the same IO kind",
        });
      if (
        dataOutputs[0] !== undefined &&
        dataInputs[0] !== undefined &&
        !DataType.equals(dataOutputs[0].type, dataInputs[0].type)
      )
        return yield* new Connection.InvalidError({ reason: "Data types are incompatible" });
      if (
        graph.connections.some(
          (connection) =>
            connection.inNodeId === options.connection.inNodeId &&
            connection.inIoId === options.connection.inIoId,
        )
      )
        return yield* new Connection.InvalidError({ reason: "Input already has a connection" });
      const connection: Connection.Model = {
        ...options.connection,
        id: Connection.ConnectionId.make(Math.random().toString(36).slice(2)),
      };
      return yield* events.publish({
        _tag: "ConnectionCreated",
        graphId: options.graphID,
        connection,
      });
    }, lock.withPermit);

    const connectionDelete = Effect.fn("Editor.connection.delete")(function* (options: {
      readonly graphID: string;
      readonly connectionId: string;
    }) {
      return yield* events.publish({
        _tag: "ConnectionDeleted",
        graphId: options.graphID,
        connectionId: options.connectionId,
      });
    }, lock.withPermit);

    const projectGet = Effect.fn("Editor.project.get")(function* () {
      return yield* persistence.loadProject();
    }, lock.withPermit);

    const projectSnapshot = Effect.fn("Editor.project.snapshot")(function* () {
      const project = yield* persistence.loadProject();
      const generated: Record<string, Record<string, NodeIO>> = {};
      for (const [graphId, graph] of Object.entries(project.graphs)) {
        generated[graphId] = {};
        for (const node of Object.values(graph.nodes)) {
          const io = yield* getNodeIO(node).pipe(
            Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(undefined)),
          );
          if (io !== undefined) generated[graphId][node.id] = io;
        }
      }
      return { project, nodeIO: generated };
    }, lock.withPermit);

    const projectRendered = Effect.fn("Editor.project.rendered")(function* () {
      const project = yield* persistence.loadProject();
      const graphs: Record<string, RenderedProject.Model["graphs"][string]> = {};
      for (const [graphId, graph] of Object.entries(project.graphs)) {
        const nodes: Record<string, RenderedProject.Model["graphs"][string]["nodes"][string]> = {};
        const schemas: Record<string, Record<string, Package.SchemaModel>> = {};
        for (const node of Object.values(graph.nodes)) {
          const schema = yield* packages.getSchema(node.schema);
          nodes[node.id] = {
            ...node,
            io: yield* getNodeIO(node),
          };
          (schemas[node.schema.package] ??= {})[node.schema.schema] = schema;
        }
        graphs[graphId] = { ...graph, nodes, schemas };
      }
      return { ...project, graphs };
    }, lock.withPermit);

    const constantCreate = Effect.fn("Editor.constant.create")(function* (
      resource: ResourceConstant.ResourceRef,
    ) {
      const pkg = (yield* packages.getPackages()).find(
        (candidate) => candidate.id === resource.package,
      );
      const definition = pkg?.resources.find((candidate) => candidate.id === resource.resource);
      if (definition === undefined)
        return yield* new ResourceConstant.InvalidResourceError({
          package: resource.package,
          resource: resource.resource,
          reason: "Resource is not registered",
        });
      const id = ResourceConstant.Id.make(crypto.randomUUID());
      const constants = (yield* persistence.loadProject()).constants;
      const isDefault = ResourceConstant.getDefault(constants, resource) === undefined;
      return yield* events.publish({
        _tag: "ResourceConstantCreated",
        constant: { id, name: `New ${definition.name}`, resource, isDefault },
      });
    }, lock.withPermit);

    const getConstant = Effect.fnUntraced(function* (id: string) {
      const constant = (yield* persistence.loadProject()).constants[id];
      if (constant === undefined) return yield* new ResourceConstant.NotFoundError({ id });
      return constant;
    });

    const constantRename = Effect.fn("Editor.constant.rename")(function* (
      id: string,
      name: string,
    ) {
      const constant = yield* getConstant(id);
      return yield* events.publish({
        _tag: "ResourceConstantUpdated",
        constant: { ...constant, name },
        nodeIO: {},
        inputDefaults: {},
        deletedConnectionIds: {},
      });
    }, lock.withPermit);

    const constantSelect = Effect.fn("Editor.constant.select")(function* (
      id: string,
      value: Schema.Json,
    ) {
      const constant = yield* getConstant(id);
      const hosted = (yield* Ref.get(hostedResources)).get(
        resourceKey(constant.resource.package, constant.resource.resource),
      );
      if (hosted === undefined)
        return yield* new ResourceConstant.InvalidResourceError({
          ...constant.resource,
          reason: "Resource engine is not hosted",
        });
      const values = yield* hosted.values;
      if (!values.some((candidate) => JSON.stringify(candidate.id) === JSON.stringify(value)))
        return yield* new ResourceConstant.InvalidResourceError({
          ...constant.resource,
          reason: "Selected value is not currently available",
        });
      const updated = { ...constant, value };
      const project = yield* persistence.loadProject();
      const constants = { ...project.constants, [id]: updated };
      const nodeIO: Record<string, Record<string, NodeIO>> = {};
      const inputDefaults: Record<string, Record<string, Record<string, Schema.Json>>> = {};
      const deletedConnectionIds: Record<string, Array<string>> = {};
      for (const [graphId, graph] of Object.entries(project.graphs)) {
        const generated = new Map<string, NodeIO>();
        for (const node of Object.values(graph.nodes)) {
          if (!Object.values(node.properties).some((propertyValue) => propertyValue === id))
            continue;
          const io = yield* resolveIOProperties(node.schema, node.properties, constants).pipe(
            Effect.flatMap((properties) => packages.getNodeIO(node.schema, properties)),
            Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(undefined)),
          );
          if (io !== undefined) {
            generated.set(node.id, io);
            (nodeIO[graphId] ??= {})[node.id] = io;
            (inputDefaults[graphId] ??= {})[node.id] = yield* retainValidInputDefaults(
              io,
              node.inputDefaults,
            );
          }
        }
        for (const connection of graph.connections) {
          if (!generated.has(connection.outNodeId) && !generated.has(connection.inNodeId)) continue;
          const outputNode = graph.nodes[connection.outNodeId];
          const inputNode = graph.nodes[connection.inNodeId];
          if (outputNode === undefined || inputNode === undefined) {
            (deletedConnectionIds[graphId] ??= []).push(connection.id);
            continue;
          }
          const outputIO =
            generated.get(outputNode.id) ??
            (yield* resolveIOProperties(outputNode.schema, outputNode.properties, constants).pipe(
              Effect.flatMap((properties) => packages.getNodeIO(outputNode.schema, properties)),
              Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(undefined)),
            ));
          const inputIO =
            generated.get(inputNode.id) ??
            (yield* resolveIOProperties(inputNode.schema, inputNode.properties, constants).pipe(
              Effect.flatMap((properties) => packages.getNodeIO(inputNode.schema, properties)),
              Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(undefined)),
            ));
          if (outputIO === undefined || inputIO === undefined) continue;
          if (!isConnectionValid(connection, outputIO, inputIO)) {
            (deletedConnectionIds[graphId] ??= []).push(connection.id);
          }
        }
      }
      return yield* events.publish({
        _tag: "ResourceConstantUpdated",
        constant: updated,
        nodeIO,
        inputDefaults,
        deletedConnectionIds,
      });
    }, lock.withPermit);

    const constantSetDefault = Effect.fn("Editor.constant.setDefault")(function* (id: string) {
      const project = yield* persistence.loadProject();
      const selected = project.constants[id];
      if (selected === undefined) return yield* new ResourceConstant.NotFoundError({ id });
      const constants = Object.values(project.constants)
        .filter(
          (constant) =>
            constant.resource.package === selected.resource.package &&
            constant.resource.resource === selected.resource.resource,
        )
        .map((constant) => ({ ...constant, isDefault: constant.id === id }));
      return yield* events.publish({ _tag: "ResourceConstantDefaultChanged", constants });
    }, lock.withPermit);

    const constantDelete = Effect.fn("Editor.constant.delete")(function* (id: string) {
      yield* getConstant(id);
      const project = yield* persistence.loadProject();
      const nodeIds: Array<string> = [];
      for (const graph of Object.values(project.graphs)) {
        for (const node of Object.values(graph.nodes)) {
          const schema = yield* packages
            .getSchema(node.schema)
            .pipe(Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(undefined)));
          if (
            schema === undefined
              ? Object.values(node.properties).some((value) => value === id)
              : schema.properties.some(
                  (property) => "resource" in property && node.properties[property.id] === id,
                )
          )
            nodeIds.push(node.id);
        }
      }
      nodeIds.sort((left, right) => left.localeCompare(right));
      if (nodeIds.length > 0) return yield* new ResourceConstant.InUseError({ id, nodeIds });
      return yield* events.publish({ _tag: "ResourceConstantDeleted", constantId: id });
    }, lock.withPermit);

    const engineSetState = Effect.fn("Editor.engine.setState")(function* (
      pluginId: string,
      state: unknown,
    ) {
      const definition = (yield* Ref.get(engines)).get(pluginId);
      if (definition === undefined) return yield* new EngineNotRegistered({ pluginId });
      const decoded = yield* Schema.decodeUnknownEffect(definition.Storage)(state).pipe(
        Effect.mapError((cause) => new InvalidEngineState({ pluginId, cause })),
      );
      const encoded = yield* Schema.encodeUnknownEffect(definition.Storage)(decoded).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
        Effect.mapError((cause) => new InvalidEngineState({ pluginId, cause })),
      );
      return yield* events.publish({ _tag: "EngineStateChanged", pluginId, state: encoded });
    }, lock.withPermit);

    const plugin: Interface["plugin"] = (...args) =>
      Effect.gen(function* () {
        const [definition, deployment] = args;
        if (
          definition.engine !== undefined &&
          (deployment === undefined ||
            deployment.pluginId !== definition.id ||
            deployment.definition !== definition.engine)
        )
          return yield* Effect.die(`Deployment does not match plugin ${definition.id}`);
        const schemas = yield* Registration.collect(definition.effect);
        const resources = definition.engine?.Resource ?? [];
        const resourceIds = new Set<string>();
        for (const resource of resources) {
          if (resourceIds.has(resource.key))
            return yield* Effect.die(
              `Plugin ${definition.id} registers duplicate resource ${resource.key}`,
            );
          resourceIds.add(resource.key);
        }
        for (const schema of schemas) {
          for (const property of schema.properties) {
            if (
              "resource" in property &&
              !resources.some((resource) => resource === property.resourceClass)
            )
              return yield* Effect.die(
                `Schema ${definition.id}/${schema.id} uses resource ${property.resource} that is not registered by its engine`,
              );
          }
        }
        const encodeValue = (type: DataType.Any, value: unknown): Schema.Json =>
          Schema.decodeUnknownSync(Schema.Json)(
            Schema.encodeUnknownSync(DataType.JsonValueSchema(type))(value),
          );
        const pkg: Package.Model = {
          id: PackageId.make(definition.id),
          name: definition.name ?? definition.id,
          resources: resources.map((resource) => ({
            id: resource.key,
            name: resource.definition.name,
            ...(resource.definition.description === undefined
              ? {}
              : { description: resource.definition.description }),
          })),
          schemas: schemas.map((schema) => ({
            id: SchemaId.make(schema.id),
            internal: schema.internal ?? false,
            name: schema.name,
            ...(schema.description === undefined ? {} : { description: schema.description }),
            type: schema.type,
            properties: schema.properties.map((property) =>
              "resource" in property
                ? {
                    id: property.id,
                    name: property.name,
                    ...(property.description === undefined
                      ? {}
                      : { description: property.description }),
                    resource: property.resource,
                    optional: false,
                  }
                : {
                    id: property.id,
                    name: property.name,
                    ...(property.description === undefined
                      ? {}
                      : { description: property.description }),
                    type: property.type,
                    optional: property.optional,
                    ...(property.defaultValue === undefined
                      ? {}
                      : { defaultValue: encodeValue(property.type, property.defaultValue) }),
                  },
            ),
            dataInputs: schema.dataInputs.map((input) => ({
              id: IoId.make(input.id),
              type: input.type,
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(input.defaultValue === undefined
                ? {}
                : { defaultValue: encodeValue(input.type, input.defaultValue) }),
              ...(input.suggestions === undefined ? {} : { suggestions: true }),
            })),
            dataOutputs: schema.dataOutputs.map((output) => ({
              id: IoId.make(output.id),
              type: output.type,
              ...(output.name === undefined ? {} : { name: output.name }),
            })),
            executionInputs: schema.executionInputs.map((input) => ({
              id: IoId.make(input.id),
              ...(input.name === undefined ? {} : { name: input.name }),
            })),
            executionOutputs: schema.executionOutputs.map((output) => ({
              id: IoId.make(output.id),
              ...(output.name === undefined ? {} : { name: output.name }),
            })),
          })),
        };
        yield* packages.loadPackage(
          pkg,
          new Map(
            schemas.map((schema) => [
              schema.id,
              {
                declaresProperties: true,
                getIO: (properties: Readonly<Record<string, unknown>>): NodeIO => {
                  const io = schema.generateIO(properties);
                  return {
                    dataInputs: io.dataInputs.map((input) => ({
                      id: IoId.make(input.id),
                      type: input.type,
                      ...(input.name === undefined ? {} : { name: input.name }),
                      ...(input.defaultValue === undefined
                        ? {}
                        : {
                            defaultValue: encodeValue(input.type, input.defaultValue),
                          }),
                      ...(input.suggestions === undefined ? {} : { suggestions: true }),
                    })),
                    dataOutputs: io.dataOutputs.map((output) => ({
                      id: IoId.make(output.id),
                      type: output.type,
                      ...(output.name === undefined ? {} : { name: output.name }),
                    })),
                    executionInputs: io.executionInputs.map((input) => ({
                      id: IoId.make(input.id),
                      ...(input.name === undefined ? {} : { name: input.name }),
                    })),
                    executionOutputs: io.executionOutputs.map((output) => ({
                      id: IoId.make(output.id),
                      ...(output.name === undefined ? {} : { name: output.name }),
                    })),
                  };
                },
                getSuggestions: (properties, inputDefaults, input) =>
                  Effect.gen(function* () {
                    const port = schema
                      .generateIO(properties)
                      .dataInputs.find((candidate) => candidate.id === input);
                    const engine = (yield* Ref.get(runtimeClients)).get(definition.id);
                    return yield* (
                      port?.suggestions?.({ properties, inputDefaults, engine }) ??
                        Effect.succeed([])
                    );
                  }),
              },
            ]),
          ),
        );
        const engine = definition.engine;
        if (engine !== undefined)
          yield* Ref.update(engines, (current) => {
            const next = new Map(current);
            next.set(definition.id, engine);
            return next;
          });
      }).pipe(lock.withPermit);

    return Service.of({
      fragment: {
        identity: () => Effect.succeed(clipboardSession),
        paste: fragmentPaste,
        delete: fragmentDelete,
      },
      project: { get: projectGet, snapshot: projectSnapshot, rendered: projectRendered },
      constant: {
        create: constantCreate,
        rename: constantRename,
        select: constantSelect,
        setDefault: constantSetDefault,
        delete: constantDelete,
      },
      graph: { create: graphCreate, update: graphUpdate, delete: graphDelete },
      node: {
        create: nodeCreate,
        update: nodeUpdate,
        setFoldPins: nodeSetFoldPins,
        setProperty: nodeSetProperty,
        clearProperty: nodeClearProperty,
        setInputDefault: nodeSetInputDefault,
        clearInputDefault: nodeClearInputDefault,
        getInputSuggestions: nodeGetInputSuggestions,
        delete: nodeDelete,
      },
      connection: { create: connectionCreate, delete: connectionDelete },
      engine: {
        setState: engineSetState,
        getEndpoints: () => Ref.get(engineEndpoints),
        setEndpoints: (endpoints) => Ref.set(engineEndpoints, endpoints),
        hostClientState: (pluginId, state) =>
          Ref.update(engineClientStates, (current) => {
            const next = new Map(current);
            next.set(pluginId, state);
            return next;
          }),
        getClientState: (pluginId) =>
          Ref.get(engineClientStates).pipe(
            Effect.flatMap((states) => {
              const state = states.get(pluginId);
              return state === undefined ? new EngineNotHosted({ pluginId }) : state;
            }),
          ),
        dirtyClientState: (pluginId) =>
          events.publishEphemeral({ _tag: "PluginClientStateDirty", pluginId }).pipe(Effect.asVoid),
        getClientCapabilities: () =>
          Ref.get(engineClientStates).pipe(
            Effect.map((states) => Array.from(states.keys()).sort()),
          ),
        hostResource: (pluginId, resourceId, resource) =>
          Effect.gen(function* () {
            const forwardingFiber = yield* resource.changes.pipe(
              Stream.runForEach((values) =>
                events.publishEphemeral({
                  _tag: "ResourceValuesUpdated",
                  package: pluginId,
                  resource: resourceId,
                  values,
                }),
              ),
              Effect.forkIn(scope),
            );
            const previous = yield* Ref.modify(hostedResources, (current) => {
              const key = resourceKey(pluginId, resourceId);
              return [
                current.get(key),
                new Map(current).set(key, { ...resource, forwardingFiber }),
              ];
            });
            if (previous !== undefined) yield* Fiber.interrupt(previous.forwardingFiber);
          }),
        getResourceValues: (pluginId, resourceId) =>
          Ref.get(hostedResources).pipe(
            Effect.flatMap((resources) => {
              const resource = resources.get(resourceKey(pluginId, resourceId));
              return resource === undefined
                ? new ResourceConstant.InvalidResourceError({
                    package: pluginId,
                    resource: resourceId,
                    reason: "Resource engine is not hosted",
                  })
                : resource.values;
            }),
          ),
        reloadResource: (pluginId, resourceId) =>
          Ref.get(hostedResources).pipe(
            Effect.flatMap((resources) => {
              const resource = resources.get(resourceKey(pluginId, resourceId));
              return resource === undefined
                ? new ResourceConstant.InvalidResourceError({
                    package: pluginId,
                    resource: resourceId,
                    reason: "Resource engine is not hosted",
                  })
                : resource.reload;
            }),
          ),
        hostRuntimeClient: (pluginId, client) =>
          Ref.update(runtimeClients, (current) => new Map(current).set(pluginId, client)),
        getRuntimeClient: (pluginId) =>
          Ref.get(runtimeClients).pipe(
            Effect.flatMap((clients) => {
              const client = clients.get(pluginId);
              return client === undefined
                ? new EngineNotHosted({ pluginId })
                : Effect.succeed(client);
            }),
          ),
      },
      plugin,
    });
  }),
);

export const defaultLayer = layer.pipe(Layer.provideMerge(EditorEvents.defaultLayer));

export * as Editor from "./Editor.ts";
