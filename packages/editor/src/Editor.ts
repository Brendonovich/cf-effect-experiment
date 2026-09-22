import type * as Engine from "@macrograph/module/Engine";
import type * as Module from "@macrograph/module/Module";

import {
  Canvas,
  Clipboard,
  Connection,
  CustomTypes,
  Function as GraphFunction,
  Scopes,
  Wildcards,
  Graph,
  GraphId,
  IoId,
  Node,
  NodeId,
  NodeIO,
  OutputRef,
  Package,
  PackageId,
  Project,
  Queue,
  RenderedProject,
  ResourceConstant,
  SchemaId,
  TypeDefinition,
} from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import * as HttpEndpoint from "@macrograph/module/HttpEndpoint";
import * as Registration from "@macrograph/module/Registration";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import {
  Clock,
  Context,
  Effect,
  Fiber,
  Layer,
  Ref,
  Result,
  Schema,
  Semaphore,
  Stream,
} from "effect";

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
type NodeSetScopeSplitOptions = {
  readonly graphID: string;
  readonly nodeID: string;
  readonly scope: string;
  readonly split: boolean;
};

export const ProjectSnapshot = Schema.Struct({
  project: Schema.Struct({
    name: Project.Model.fields.name,
    graphs: Schema.Record(Schema.String, Canvas.Model),
    functions: Project.Model.fields.functions,
    engines: Project.Model.fields.engines,
    constants: Project.Model.fields.constants,
    queues: Project.Model.fields.queues,
    types: Project.Model.fields.types,
  }),
  nodeIO: Schema.Record(Schema.String, Schema.Record(Schema.String, NodeIO)),
});
export type ProjectSnapshot = typeof ProjectSnapshot.Type;

type NodeMutationError =
  | PersistenceError
  | Project.NotFoundError
  | Graph.NotFoundError
  | Node.NotFoundError;

type TypeMutationError =
  | PersistenceError
  | Project.NotFoundError
  | TypeDefinition.InvalidError
  | TypeDefinition.NotFoundError;

const emptyNodeIO: NodeIO = {
  dataInputs: [],
  dataOutputs: [],
  executionInputs: [],
  executionOutputs: [],
};

// Exact canonical state, not a hash: no collision can authorize a stale proposal.
const projectState = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

export class EngineNotRegistered extends Schema.TaggedError<EngineNotRegistered>()(
  "EngineNotRegistered",
  { moduleId: Schema.String },
) {}

export class EngineNotHosted extends Schema.TaggedError<EngineNotHosted>()("EngineNotHosted", {
  moduleId: Schema.String,
}) {}

export class InvalidEngineState extends Schema.TaggedError<InvalidEngineState>()(
  "InvalidEngineState",
  { moduleId: Schema.String, cause: Schema.Unknown },
) {}

export interface HostedResource {
  readonly values: Effect.Effect<ReadonlyArray<ResourceConstant.LiveValue>>;
  readonly reload: Effect.Effect<void>;
  readonly changes: Stream.Stream<ReadonlyArray<ResourceConstant.LiveValue>>;
}

export interface Interface {
  readonly typeDefinition: {
    readonly preview: (
      change: TypeDefinition.Change,
    ) => Effect.Effect<TypeDefinition.Impact, TypeMutationError>;
    readonly confirm: (options: {
      readonly token: string;
    }) => Effect.Effect<
      EditorEvent.TypeDefinitionsUpdated,
      TypeMutationError | TypeDefinition.StalePreviewError
    >;
  };
  readonly fragment: {
    readonly identity: () => Effect.Effect<string>;
    readonly paste: (options: {
      readonly graphID: string;
      readonly text: string;
      readonly position: { readonly x: number; readonly y: number };
      readonly bindings?: ReadonlyArray<Clipboard.Binding>;
      readonly skipMissingSchemas?: boolean;
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
  readonly queue: {
    readonly create: (name: string) => Effect.Effect<EditorEvent.QueueUpdated, PersistenceError>;
    readonly rename: (
      id: string,
      name: string,
    ) => Effect.Effect<
      EditorEvent.QueueUpdated,
      PersistenceError | Project.NotFoundError | Queue.NotFoundError
    >;
    readonly delete: (
      id: string,
    ) => Effect.Effect<
      EditorEvent.QueueDeleted,
      PersistenceError | Project.NotFoundError | Queue.NotFoundError
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
  readonly function: {
    readonly create: (
      name?: string,
    ) => Effect.Effect<EditorEvent.FunctionCreated, PersistenceError>;
    readonly addField: (
      graphId: string,
      direction: "input" | "output",
    ) => Effect.Effect<
      EditorEvent.FunctionUpdated,
      PersistenceError | Project.NotFoundError | GraphFunction.NotFoundError
    >;
    readonly updateField: (
      graphId: string,
      direction: "input" | "output",
      field: GraphFunction.Field,
    ) => Effect.Effect<
      EditorEvent.FunctionUpdated,
      PersistenceError | Project.NotFoundError | Graph.NotFoundError | GraphFunction.NotFoundError
    >;
    readonly reorderField: (
      graphId: string,
      direction: "input" | "output",
      fieldId: string,
      targetFieldId: string,
    ) => Effect.Effect<
      EditorEvent.FunctionUpdated,
      PersistenceError | Project.NotFoundError | GraphFunction.NotFoundError
    >;
    readonly deleteField: (
      graphId: string,
      direction: "input" | "output",
      fieldId: string,
    ) => Effect.Effect<
      EditorEvent.FunctionUpdated,
      PersistenceError | Project.NotFoundError | GraphFunction.NotFoundError
    >;
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
      | GraphFunction.EventNodeNotAllowedError
    >;
    readonly update: (options: NodeUpdateOptions) => Effect.Effect<void, NodeMutationError>;
    readonly setFoldPins: (
      options: NodeSetFoldPinsOptions,
    ) => Effect.Effect<EditorEvent.NodeFoldPinsChanged, NodeMutationError>;
    readonly setScopeSplit: (
      options: NodeSetScopeSplitOptions,
    ) => Effect.Effect<
      EditorEvent.NodeScopeSplitChanged,
      NodeMutationError | Package.SchemaNotFoundError | Connection.InvalidError
    >;
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
  readonly scopeProjection: {
    readonly create: (options: {
      readonly graphID: string;
      readonly position: { readonly x: number; readonly y: number };
      readonly sourceNodeID: string;
      readonly sourceOutput: OutputRef.Model;
    }) => Effect.Effect<
      EditorEvent.ScopeProjectionCreated,
      NodeMutationError | Package.SchemaNotFoundError | Connection.InvalidError
    >;
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
      moduleId: string,
      state: unknown,
    ) => Effect.Effect<
      EditorEvent.EngineStateChanged,
      PersistenceError | EngineNotRegistered | InvalidEngineState
    >;
    readonly getEndpoints: () => Effect.Effect<ReadonlyArray<HttpEndpoint.Routed>>;
    readonly setEndpoints: (endpoints: ReadonlyArray<HttpEndpoint.Routed>) => Effect.Effect<void>;
    readonly hostClientState: (
      moduleId: string,
      state: Effect.Effect<Schema.Json>,
    ) => Effect.Effect<void>;
    readonly getClientState: (moduleId: string) => Effect.Effect<Schema.Json, EngineNotHosted>;
    readonly dirtyClientState: (moduleId: string) => Effect.Effect<void>;
    readonly getClientCapabilities: () => Effect.Effect<ReadonlyArray<string>>;
    readonly hostResource: (
      moduleId: string,
      resourceId: string,
      resource: HostedResource,
    ) => Effect.Effect<void>;
    readonly getResourceValues: (
      moduleId: string,
      resourceId: string,
    ) => Effect.Effect<
      ReadonlyArray<ResourceConstant.LiveValue>,
      ResourceConstant.InvalidResourceError
    >;
    readonly reloadResource: (
      moduleId: string,
      resourceId: string,
    ) => Effect.Effect<void, ResourceConstant.InvalidResourceError>;
    readonly hostRuntimeClient: (moduleId: string, client: unknown) => Effect.Effect<void>;
    readonly getRuntimeClient: (moduleId: string) => Effect.Effect<unknown, EngineNotHosted>;
  };
  readonly module: <Definition extends Engine.AnyDef = never>(
    ...args: Module.RegisterArgs<Definition>
  ) => Effect.Effect<void>;
}

/** Coordinates project editing, resource constants, module registration, and hosted engines. */
export class Service extends Context.Service<Service, Interface>()("macrograph/Editor") {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    const scope = yield* Effect.scope;
    const events = yield* EditorEvents.Service;
    const packages = yield* Packages.Service;
    const lock = yield* Semaphore.make(1);
    const initialProject = yield* persistence.loadProject().pipe(
      Effect.catchTag("ProjectNotFoundError", () => Effect.succeed(undefined)),
      Effect.orDie,
    );
    yield* packages.setTypeDefinitions(initialProject?.types ?? {});
    const previews = new Map<
      string,
      {
        readonly state: string;
        readonly change: TypeDefinition.Change;
        readonly expires: number;
        readonly packages: string;
      }
    >();
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
    const resourceKey = (moduleId: string, resourceId: string) =>
      ResourceKey.make(`${moduleId}\0${resourceId}`);
    const resolveIOProperties = Effect.fnUntraced(function* (
      schemaRef: Node.Model["schema"],
      persistedProperties: Readonly<Record<string, Schema.Json>>,
      constants?: Readonly<Record<string, ResourceConstant.Model>>,
    ) {
      if (schemaRef.package === CustomTypes.packageId) return persistedProperties;
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
    const getBaseNodeIO = (node: Node.Model, definitions?: DataType.Definitions) =>
      GraphFunction.isCall(node)
        ? persistence.loadProject().pipe(
            Effect.map((project) => {
              const target = node.properties.function;
              return GraphFunction.callIO(
                typeof target === "string" ? project.functions[target] : undefined,
              );
            }),
          )
        : resolveIOProperties(node.schema, node.properties).pipe(
            Effect.flatMap((properties) =>
              packages.getNodeIO(node.schema, properties, definitions),
            ),
          );
    const validateQueueTarget = Effect.fnUntraced(function* (
      node: Pick<Node.Model, "schema" | "properties">,
    ) {
      if (!GraphFunction.isQueuedCall(node)) return;
      const queueId = node.properties.queue;
      const project = yield* persistence.loadProject();
      if (typeof queueId !== "string" || project.queues[queueId] === undefined)
        return yield* new Package.InvalidPropertyError({
          property: "queue",
          reason: "Selected queue does not exist",
        });
    });
    const getNodeIO = Effect.fnUntraced(function* (
      node: Node.Model,
      definitions?: DataType.Definitions,
    ) {
      if (Scopes.isProjectionNode(node)) {
        const project = yield* persistence.loadProject();
        const graph = Object.values(Project.canvases(project)).find(
          (graph) => graph.scopeProjections?.[node.id] !== undefined,
        );
        if (graph === undefined) return emptyNodeIO;
        const { declarations } = yield* graphWildcards(graph, {}, undefined, definitions);
        return declarations.get(node.id) ?? emptyNodeIO;
      }
      const io = yield* getBaseNodeIO(node, definitions);
      if (!CustomTypes.isOperationNode(node)) return io;
      const project = yield* persistence.loadProject();
      const graph = Object.values(Project.canvases(project)).find((graph) =>
        Object.hasOwn(graph.nodes, node.id),
      );
      if (graph === undefined) return io;
      const { declarations } = yield* graphWildcards(
        graph,
        { [node.id]: io },
        undefined,
        definitions,
      );
      return declarations.get(node.id) ?? io;
    });
    const wildcardCaches = new Map<string, Wildcards.Cache>();
    const graphWildcards = Effect.fnUntraced(function* (
      graph: Canvas.Model,
      overrides: Readonly<Record<string, NodeIO>> = {},
      cache: Wildcards.Cache = wildcardCaches.get(graph.id) ?? new Wildcards.Cache(),
      definitions?: DataType.Definitions,
    ): Effect.fn.Return<
      {
        cache: Wildcards.Cache;
        declarations: Map<string, NodeIO>;
        result: Result.Result<void, ReadonlyArray<Wildcards.Conflict>>;
      },
      PersistenceError | Project.NotFoundError
    > {
      const declarations = new Map<string, NodeIO>();
      for (const node of Object.values(graph.nodes)) {
        const io =
          overrides[node.id] ??
          (yield* getBaseNodeIO(node, definitions).pipe(
            Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(undefined)),
          ));
        if (io !== undefined) declarations.set(node.id, io);
      }
      for (const projection of Object.values(graph.scopeProjections ?? {}))
        declarations.set(
          projection.id,
          Scopes.projectionIO(graph, projection.id, (id) => declarations.get(id)),
        );
      const derive = CustomTypes.derivedIO(
        graph,
        definitions ?? (yield* persistence.loadProject()).types,
      );
      let result = cache.update(declarations, graph.connections, derive);
      if (Result.isSuccess(result)) {
        for (const [id, io] of declarations) {
          const derived = cache.derivedIO(id);
          if (derived !== undefined) declarations.set(id, { ...io, ...derived });
        }
        for (const projection of Object.values(graph.scopeProjections ?? {}))
          declarations.set(
            projection.id,
            Scopes.projectionIO(graph, projection.id, (id) => declarations.get(id)),
          );
        result = cache.update(declarations, graph.connections, derive);
      }
      wildcardCaches.set(graph.id, cache);
      return { cache, declarations, result };
    });
    const retainValidInputDefaults = Effect.fnUntraced(function* (
      io: NodeIO,
      defaults: Readonly<Record<string, Schema.Json>>,
    ) {
      const retained: Record<string, Schema.Json> = {};
      const definitions = (yield* persistence.loadProject()).types;
      for (const input of Object.keys(defaults).sort()) {
        const ports = io.dataInputs.filter((port) => port.id === input);
        if (ports.length !== 1 || io.executionInputs.some((port) => port.id === input)) continue;
        const valid = yield* Schema.decodeUnknownEffect(
          DataType.JsonValueSchema(ports[0]!.type, definitions),
        )(defaults[input]).pipe(
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
      const output = OutputRef.resolve(outputIO, connection.outIo);
      const executionOutputs = output?.kind === "execution" ? [output.port] : [];
      const dataOutputs = output?.kind === "data" ? [output.port] : [];
      const executionInputs = inputIO.executionInputs.filter(
        (input) => input.id === connection.inIoId,
      );
      const dataInputs = inputIO.dataInputs.filter((input) => input.id === connection.inIoId);
      if (executionOutputs.length + dataOutputs.length !== 1) return false;
      if (executionInputs.length + dataInputs.length !== 1) return false;
      if ((executionOutputs.length === 1) !== (executionInputs.length === 1)) return false;
      if (
        executionOutputs.length === 1 &&
        !Registration.scopesCompatible(executionOutputs[0]!.scope, executionInputs[0]!.scope)
      )
        return false;
      const dataOutput = dataOutputs[0];
      const dataInput = dataInputs[0];
      return dataOutput === undefined || dataInput === undefined
        ? dataOutput === undefined && dataInput === undefined
        : DataType.compatible(dataOutput.type, dataInput.type);
    };

    const proposedTypes = Effect.fnUntraced(function* (
      project: Project.Model,
      change: TypeDefinition.Change,
    ) {
      if (change._tag === "Delete" && !Object.hasOwn(project.types, change.id))
        return yield* new TypeDefinition.NotFoundError({ id: change.id });
      const error = TypeDefinition.validateChange(project.types, change)[0];
      if (error !== undefined) return yield* error;
      const types = { ...project.types };
      if (change._tag === "Delete") delete types[change.id];
      else types[change.definition.id] = change.definition;
      return types;
    });

    const typePreview = Effect.fn("Editor.typeDefinition.preview")(function* (
      input: TypeDefinition.Change,
    ) {
      const change = yield* Schema.decodeUnknownEffect(TypeDefinition.Change, {
        onExcessProperty: "error",
      })(input).pipe(
        Effect.catchTag(
          "SchemaError",
          () => new TypeDefinition.InvalidError({ id: "", reason: "Malformed type change" }),
        ),
      );
      const project = yield* persistence.loadProject();
      const types = yield* proposedTypes(project, change);
      const definitionsChanged = projectState(project.types) !== projectState(types);
      const id = change._tag === "Delete" ? change.id : change.definition.id;
      const affectedTypes = TypeDefinition.affectedTypes(id, project.types, types);
      const affected = new Set(affectedTypes);
      const nodes: Array<TypeDefinition.Impact["nodes"][number]> = [];
      for (const [graphId, graph] of Object.entries(Project.canvases(project)).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const before: Record<string, NodeIO> = {};
        const after: Record<string, NodeIO> = {};
        const reasons = new Map<string, Set<string>>();
        const add = (nodeId: string, reason: string) => {
          const entry = reasons.get(nodeId) ?? new Set<string>();
          entry.add(reason);
          reasons.set(nodeId, entry);
        };
        for (const node of Object.values(graph.nodes)) {
          const io = yield* getNodeIO(node, project.types).pipe(
            Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(emptyNodeIO)),
          );
          before[node.id] = io;
          const nextIO = yield* getNodeIO(node, types).pipe(
            Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(emptyNodeIO)),
          );
          after[node.id] = nextIO;
          if (!definitionsChanged) continue;
          for (const port of [
            ...io.dataInputs,
            ...io.dataOutputs,
            ...nextIO.dataInputs,
            ...nextIO.dataOutputs,
            ...io.executionInputs.flatMap((port) => port.scope ?? []),
            ...io.executionOutputs.flatMap((port) => port.scope ?? []),
            ...nextIO.executionInputs.flatMap((port) => port.scope ?? []),
            ...nextIO.executionOutputs.flatMap((port) => port.scope ?? []),
          ])
            for (const ref of TypeDefinition.references(port.type))
              if (affected.has(ref)) add(node.id, `Port ${port.id} uses affected type ${ref}`);
          for (const ref of TypeDefinition.valueReferences(node.properties))
            if (affected.has(ref)) add(node.id, `Property uses affected type ${ref}`);
          for (const ref of TypeDefinition.valueReferences(node.inputDefaults))
            if (affected.has(ref)) add(node.id, `Default uses affected type ${ref}`);
          if (projectState(io) !== projectState(nextIO))
            add(node.id, "Generated inputs or outputs change");
          const previous = new Set(TypeDefinition.nodeDiagnostics(node, io, project.types));
          for (const reason of TypeDefinition.nodeDiagnostics(node, nextIO, types))
            if (!previous.has(reason) || reasons.has(node.id)) add(node.id, reason);
        }
        const fn = project.functions[graphId];
        if (fn !== undefined) {
          for (const nodeId of [
            GraphFunction.InputBoundaryNodeId,
            GraphFunction.OutputBoundaryNodeId,
          ]) {
            const io = GraphFunction.boundaryIO(fn, nodeId)!;
            before[nodeId] = io;
            after[nodeId] = io;
          }
        }
        for (const projection of Object.values(graph.scopeProjections ?? {})) {
          before[projection.id] = Scopes.projectionIO(graph, projection.id, (id) => before[id]);
          after[projection.id] = Scopes.projectionIO(graph, projection.id, (id) => after[id]);
          if (projectState(before[projection.id]) !== projectState(after[projection.id]))
            add(projection.id, "Projected scope fields change");
        }
        for (const wire of definitionsChanged ? graph.connections : []) {
          const oldOut = before[wire.outNodeId] ?? emptyNodeIO;
          const oldIn = before[wire.inNodeId] ?? emptyNodeIO;
          const newOut = after[wire.outNodeId] ?? emptyNodeIO;
          const newIn = after[wire.inNodeId] ?? emptyNodeIO;
          const usesAffected = [
            ...[OutputRef.resolve(oldOut, wire.outIo)].flatMap((p) =>
              p?.kind === "data" ? [p.port] : [],
            ),
            ...oldIn.dataInputs.filter((p) => p.id === wire.inIoId),
            ...[OutputRef.resolve(newOut, wire.outIo)].flatMap((p) =>
              p?.kind === "data" ? [p.port] : [],
            ),
            ...newIn.dataInputs.filter((p) => p.id === wire.inIoId),
          ].some((port) => TypeDefinition.references(port.type).some((ref) => affected.has(ref)));
          const changedEndpoint =
            projectState(oldOut) !== projectState(newOut) ||
            projectState(oldIn) !== projectState(newIn);
          if (usesAffected || changedEndpoint) {
            const reason = isConnectionValid(wire, newOut, newIn)
              ? `Connection ${wire.id} uses an affected endpoint`
              : `Connection ${wire.id} will be removed: missing endpoint or incompatible types`;
            if (graph.nodes[wire.outNodeId] !== undefined) add(wire.outNodeId, reason);
            if (graph.nodes[wire.inNodeId] !== undefined) add(wire.inNodeId, reason);
          }
        }
        for (const [nodeId, entries] of [...reasons].sort(([a], [b]) => a.localeCompare(b)))
          nodes.push({ graphId, nodeId, reasons: [...entries].sort() });
      }
      const now = yield* Clock.currentTimeMillis;
      for (const [token, preview] of previews) if (preview.expires <= now) previews.delete(token);
      while (previews.size >= 128) previews.delete(previews.keys().next().value!);
      const token = crypto.randomUUID();
      // Clone the proposal so in-process callers cannot alter an already reviewed change.
      previews.set(token, {
        state: projectState(project),
        change: structuredClone(change),
        expires: now + 300_000,
        packages: projectState(yield* packages.getPackages()),
      });
      return {
        token,
        change,
        affectedTypes: definitionsChanged ? affectedTypes.filter((typeId) => typeId !== id) : [],
        nodes,
      };
    }, lock.withPermit);

    const typeConfirm = Effect.fn("Editor.typeDefinition.confirm")(function* ({
      token,
    }: {
      readonly token: string;
    }) {
      const preview = previews.get(token);
      if (preview === undefined) return yield* new TypeDefinition.StalePreviewError();
      previews.delete(token);
      const project = yield* persistence.loadProject();
      if (
        preview.expires <= (yield* Clock.currentTimeMillis) ||
        preview.state !== projectState(project) ||
        preview.packages !== projectState(yield* packages.getPackages())
      )
        return yield* new TypeDefinition.StalePreviewError();
      const types = yield* proposedTypes(project, preview.change);
      return yield* Effect.gen(function* () {
        yield* packages.setTypeDefinitions(types);
        const nodeIO: Record<string, Record<string, NodeIO>> = {};
        const deletedConnectionIds: Record<string, Array<string>> = {};
        for (const [graphId, graph] of Object.entries(Project.canvases(project))) {
          nodeIO[graphId] = {};
          const resolved = new Set<string>();
          for (const node of Object.values(graph.nodes)) {
            const result = yield* getNodeIO(node, types).pipe(
              Effect.map((io) => ({ io, resolved: true as const })),
              Effect.catchTag("SchemaNotFoundError", () =>
                Effect.succeed({ io: emptyNodeIO, resolved: false as const }),
              ),
            );
            nodeIO[graphId][node.id] = result.io;
            if (result.resolved) resolved.add(node.id);
          }
          const fn = project.functions[graphId];
          if (fn !== undefined) {
            for (const nodeId of [
              GraphFunction.InputBoundaryNodeId,
              GraphFunction.OutputBoundaryNodeId,
            ]) {
              nodeIO[graphId][nodeId] = GraphFunction.boundaryIO(fn, nodeId)!;
              resolved.add(nodeId);
            }
          }
          for (const projection of Object.values(graph.scopeProjections ?? {})) {
            nodeIO[graphId][projection.id] = Scopes.projectionIO(
              graph,
              projection.id,
              (id) => nodeIO[graphId]?.[id],
            );
            resolved.add(projection.id);
          }
          for (const connection of graph.connections) {
            if (
              (graph.nodes[connection.outNodeId] === undefined &&
                !resolved.has(connection.outNodeId)) ||
              (graph.nodes[connection.inNodeId] === undefined && !resolved.has(connection.inNodeId))
            ) {
              (deletedConnectionIds[graphId] ??= []).push(connection.id);
              continue;
            }
            if (!resolved.has(connection.outNodeId) || !resolved.has(connection.inNodeId)) continue;
            if (
              !isConnectionValid(
                connection,
                nodeIO[graphId][connection.outNodeId]!,
                nodeIO[graphId][connection.inNodeId]!,
              )
            )
              (deletedConnectionIds[graphId] ??= []).push(connection.id);
          }
        }
        return yield* events.publish({
          _tag: "TypeDefinitionsUpdated",
          types,
          nodeIO,
          deletedConnectionIds,
        });
      }).pipe(
        Effect.onError(() => packages.setTypeDefinitions(project.types)),
        Effect.uninterruptible,
      );
    }, lock.withPermit);

    const endpointIO = Effect.fnUntraced(function* (
      project: Project.Model,
      graph: Canvas.Model,
      nodeId: string,
    ) {
      const node = graph.nodes[nodeId];
      if (node !== undefined) return yield* getNodeIO(node);
      if (graph.scopeProjections?.[nodeId] !== undefined) {
        const { declarations } = yield* graphWildcards(graph);
        return declarations.get(nodeId) ?? emptyNodeIO;
      }
      const fn = project.functions[graph.id];
      if (fn !== undefined) {
        const io = GraphFunction.boundaryIO(fn, nodeId);
        if (io !== undefined) return io;
      }
      return yield* new Node.NotFoundError({ id: nodeId });
    });

    const graphCreate = Effect.fn("Editor.graph.create")(function* (input: Graph.CreateInput) {
      const graphId = GraphId.make(Math.random().toString(36).slice(2));
      const graph: Graph.Model = {
        canvas: {
          id: graphId,
          name: input.name ?? "New Graph",
          nodes: input.nodes ?? {},
          connections: input.connections ?? [],
        },
      };
      return yield* events.publish({ _tag: "GraphCreated", graph: graph.canvas });
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
      const event = yield* events.publish({ _tag: "GraphDeleted", graphId: options.graphID });
      wildcardCaches.delete(options.graphID);
      return event;
    }, lock.withPermit);

    const functionCreate = Effect.fn("Editor.function.create")(function* (name?: string) {
      const graphId = GraphId.make(crypto.randomUUID());
      const canvas: Canvas.Model = {
        id: graphId,
        name: name ?? "New Function",
        nodes: {},
        connections: [],
      };
      const fn: GraphFunction.Model = {
        canvas,
        arguments: [],
        returns: [],
        inputPosition: { x: 200, y: 300 },
        outputPosition: { x: 800, y: 300 },
      };
      return yield* events.publish({ _tag: "FunctionCreated", graph: canvas, fn });
    }, lock.withPermit);

    const functionFields = (fn: GraphFunction.Model, direction: "input" | "output") =>
      direction === "input" ? fn.arguments : fn.returns;
    const withFunctionFields = (
      fn: GraphFunction.Model,
      direction: "input" | "output",
      fields: ReadonlyArray<GraphFunction.Field>,
    ): GraphFunction.Model =>
      direction === "input" ? { ...fn, arguments: fields } : { ...fn, returns: fields };
    const getFunction = Effect.fnUntraced(function* (graphId: string) {
      return yield* Project.getFunction(yield* persistence.loadProject(), graphId);
    });
    const functionAddField = Effect.fn("Editor.function.addField")(function* (
      graphId: string,
      direction: "input" | "output",
    ) {
      const fn = yield* getFunction(graphId);
      const fields = functionFields(fn, direction);
      const id = IoId.make(crypto.randomUUID());
      const field: GraphFunction.Field = {
        id,
        name: `${direction === "input" ? "Input" : "Output"} ${fields.length + 1}`,
        type: DataType.String,
      };
      return yield* events.publish({
        _tag: "FunctionUpdated",
        fn: withFunctionFields(fn, direction, [...fields, field]),
        deletedConnectionIds: [],
      });
    }, lock.withPermit);
    const functionUpdateField = Effect.fn("Editor.function.updateField")(function* (
      graphId: string,
      direction: "input" | "output",
      field: GraphFunction.Field,
    ) {
      const fn = yield* getFunction(graphId);
      const fields = functionFields(fn, direction);
      const previous = fields.find((candidate) => candidate.id === field.id);
      if (previous === undefined)
        return yield* new GraphFunction.NotFoundError({ canvasId: graphId });
      const graph = yield* persistence.loadGraph(graphId);
      const deletedConnectionIds = DataType.equals(previous.type, field.type)
        ? []
        : graph.connections
            .filter((connection) =>
              direction === "input"
                ? connection.outNodeId === GraphFunction.InputBoundaryNodeId &&
                  OutputRef.equals(connection.outIo, OutputRef.port(field.id))
                : connection.inNodeId === GraphFunction.OutputBoundaryNodeId &&
                  connection.inIoId === field.id,
            )
            .map((connection) => connection.id);
      return yield* events.publish({
        _tag: "FunctionUpdated",
        fn: withFunctionFields(
          fn,
          direction,
          fields.map((candidate) => (candidate.id === field.id ? field : candidate)),
        ),
        deletedConnectionIds,
      });
    }, lock.withPermit);
    const functionDeleteField = Effect.fn("Editor.function.deleteField")(function* (
      graphId: string,
      direction: "input" | "output",
      fieldId: string,
    ) {
      const project = yield* persistence.loadProject();
      const fn = yield* Project.getFunction(project, graphId);
      const fields = functionFields(fn, direction);
      if (!fields.some((field) => field.id === fieldId))
        return yield* new GraphFunction.NotFoundError({ canvasId: graphId });
      const graph = fn.canvas;
      const deletedConnectionIds =
        graph?.connections
          .filter((connection) =>
            direction === "input"
              ? connection.outNodeId === GraphFunction.InputBoundaryNodeId &&
                OutputRef.equals(connection.outIo, OutputRef.port(fieldId))
              : connection.inNodeId === GraphFunction.OutputBoundaryNodeId &&
                connection.inIoId === fieldId,
          )
          .map((connection) => connection.id) ?? [];
      return yield* events.publish({
        _tag: "FunctionUpdated",
        fn: withFunctionFields(
          fn,
          direction,
          fields.filter((field) => field.id !== fieldId),
        ),
        deletedConnectionIds,
      });
    }, lock.withPermit);
    const functionReorderField = Effect.fn("Editor.function.reorderField")(function* (
      graphId: string,
      direction: "input" | "output",
      fieldId: string,
      targetFieldId: string,
    ) {
      const fn = yield* getFunction(graphId);
      const fields = [...functionFields(fn, direction)];
      const from = fields.findIndex((field) => field.id === fieldId);
      const to = fields.findIndex((field) => field.id === targetFieldId);
      if (from < 0 || to < 0) return yield* new GraphFunction.NotFoundError({ canvasId: graphId });
      const [moved] = fields.splice(from, 1);
      if (moved === undefined) return yield* new GraphFunction.NotFoundError({ canvasId: graphId });
      fields.splice(to, 0, moved);
      return yield* events.publish({
        _tag: "FunctionUpdated",
        fn: withFunctionFields(fn, direction, fields),
        deletedConnectionIds: [],
      });
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
      yield* validateQueueTarget({ schema: options.node.schema, properties });
      const inputDefaults: Record<string, Schema.Json> = {};
      const ioProperties = yield* resolveIOProperties(options.node.schema, properties);
      for (const [input, value] of Object.entries(options.node.inputDefaults ?? {})) {
        inputDefaults[input] = yield* packages.validateInputDefault(
          options.node.schema,
          ioProperties,
          input,
          value,
          (yield* persistence.loadProject()).types,
        );
      }
      const nodeId = NodeId.make(Math.random().toString(36).slice(2));
      const node: Node.Model = {
        id: nodeId,
        name: options.node.name ?? schema.name,
        properties,
        inputDefaults,
        foldPins: options.node.foldPins ?? false,
        ...(options.node.splitScopeOutputs === undefined
          ? {}
          : { splitScopeOutputs: options.node.splitScopeOutputs }),
        schema: options.node.schema,
        position: options.node.position ?? { x: 0, y: 0 },
      };
      const project = yield* persistence.loadProject();
      const fn = project.functions[options.graphID];
      if (fn !== undefined) yield* GraphFunction.validateNode(fn, node, schema);
      else {
        const graph = yield* Project.getGraph(project, options.graphID);
        yield* Graph.validateNode(graph, node, schema);
      }
      const io = yield* getNodeIO(node);
      return yield* events.publish({ _tag: "NodeCreated", graphId: options.graphID, node, io });
    }, lock.withPermit);

    const fragmentPaste = Effect.fn("Editor.fragment.paste")(
      function* (options: {
        readonly graphID: string;
        readonly text: string;
        readonly position: { readonly x: number; readonly y: number };
        readonly bindings?: ReadonlyArray<Clipboard.Binding>;
        readonly skipMissingSchemas?: boolean;
      }) {
        const fragment = yield* Clipboard.decode(options.text);
        if (!Clipboard.validPosition(options.position))
          return yield* new Clipboard.InvalidError({ reason: "Invalid paste position" });
        const graph = yield* persistence.loadGraph(options.graphID);
        const project = yield* persistence.loadProject();
        const sameProject = fragment.source?.session === clipboardSession;
        const availablePackages = yield* packages.getPackages();
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
            missingNodeIds.add(source.id);
            const names = fragment.nodeSchemas?.[source.id];
            missingSchemas.set(key, {
              ...source.schema,
              moduleName:
                names?.moduleName ??
                availablePackages.find((candidate) => candidate.id === source.schema.package)
                  ?.name ??
                source.schema.package,
              schemaName:
                names?.schemaName ??
                source.schema.schema
                  .replace(/^(?:emit|on|call):/, "")
                  .replace(/[-_:]+/g, " ")
                  .replace(/\b\w/g, (character) => character.toUpperCase()),
            });
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
        if (missingSchemas.size > 0 && !options.skipMissingSchemas)
          return yield* new Clipboard.MissingSchemas({ schemas: [...missingSchemas.values()] });
        if (requests.length > 0) return yield* new Clipboard.RebindRequired({ requests });
        const nodes: Array<Node.Model> = [];
        const scopeProjections: Array<Scopes.Projection> = [];
        const nodeIO: Record<string, NodeIO> = {};
        const remap = new Map<string, NodeId>();
        const positions = [
          ...fragment.nodes.map((node) => node.position),
          ...(fragment.scopeProjections ?? []).map((projection) => projection.position),
        ];
        const anchor = {
          x: Math.min(...positions.map((position) => position.x)),
          y: Math.min(...positions.map((position) => position.y)),
        };
        for (const source of resolved) {
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
            const declaredIO = yield* packages.getNodeIO(source.schema, ioProperties);
            const inputDefaults: Record<string, Schema.Json> = {};
            for (const [input, value] of Object.entries(source.inputDefaults)) {
              const port = declaredIO.dataInputs.find((port) => port.id === input);
              // Wildcard defaults can only be checked after all pasted wires are known.
              inputDefaults[input] =
                port !== undefined && DataType.hasWildcard(port.type)
                  ? value
                  : yield* packages.validateInputDefault(source.schema, ioProperties, input, value);
            }
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
        for (const source of fragment.scopeProjections ?? []) {
          let id = NodeId.make(crypto.randomUUID());
          while (
            Object.hasOwn(graph.nodes, id) ||
            Object.hasOwn(graph.scopeProjections ?? {}, id) ||
            nodes.some((node) => node.id === id) ||
            scopeProjections.some((projection) => projection.id === id)
          )
            id = NodeId.make(crypto.randomUUID());
          const position = {
            x: options.position.x + source.position.x - anchor.x,
            y: options.position.y + source.position.y - anchor.y,
          };
          if (!Clipboard.validPosition(position))
            return yield* new Clipboard.InvalidError({ reason: "Pasted position exceeds limits" });
          scopeProjections.push({ id, position });
          remap.set(source.id, id);
        }
        const connections: Array<Connection.Model> = [];
        const connectionIds = new Set(graph.connections.map((connection) => connection.id));
        const external =
          sameProject && fragment.source?.graphId === options.graphID
            ? (fragment.externalConnections ?? [])
            : [];
        const proposedGraph: Canvas.Model = {
          ...graph,
          nodes: { ...graph.nodes, ...Object.fromEntries(nodes.map((node) => [node.id, node])) },
          scopeProjections: {
            ...graph.scopeProjections,
            ...Object.fromEntries(
              scopeProjections.map((projection) => [projection.id, projection]),
            ),
          },
          connections: [
            ...graph.connections,
            ...[...fragment.connections, ...external]
              .filter(
                (wire) => !missingNodeIds.has(wire.outNodeId) && !missingNodeIds.has(wire.inNodeId),
              )
              .map((wire) => ({
                ...wire,
                id: Connection.ConnectionId.make(crypto.randomUUID()),
                outNodeId: remap.get(wire.outNodeId) ?? wire.outNodeId,
                inNodeId: remap.get(wire.inNodeId) ?? wire.inNodeId,
              })),
          ],
        };
        if (nodes.some(CustomTypes.isOperationNode) || scopeProjections.length > 0) {
          const inferred = yield* graphWildcards(proposedGraph, nodeIO);
          for (const node of nodes) {
            const io = inferred.declarations.get(node.id);
            if (io !== undefined) nodeIO[node.id] = io;
          }
          for (const projection of scopeProjections) {
            const io = inferred.declarations.get(projection.id);
            if (io !== undefined) nodeIO[projection.id] = io;
          }
        }
        const occupied = new Set(
          graph.connections.map((connection) =>
            JSON.stringify([connection.inNodeId, connection.inIoId]),
          ),
        );
        for (const original of [...fragment.connections, ...external]) {
          if (missingNodeIds.has(original.outNodeId) || missingNodeIds.has(original.inNodeId))
            continue;
          const isExternal = external.includes(original);
          const outNodeId = remap.get(original.outNodeId) ?? original.outNodeId;
          const inNodeId = remap.get(original.inNodeId) ?? original.inNodeId;
          const outputIO =
            nodeIO[outNodeId] ??
            (Object.hasOwn(graph.nodes, outNodeId)
              ? yield* getNodeIO(graph.nodes[outNodeId]!).pipe(
                  Effect.catchCause(() => Effect.succeed(undefined)),
                )
              : graph.scopeProjections?.[outNodeId] !== undefined
                ? yield* endpointIO(project, graph, outNodeId).pipe(
                    Effect.catchCause(() => Effect.succeed(undefined)),
                  )
                : undefined);
          const inputIO =
            nodeIO[inNodeId] ??
            (Object.hasOwn(graph.nodes, inNodeId)
              ? yield* getNodeIO(graph.nodes[inNodeId]!).pipe(
                  Effect.catchCause(() => Effect.succeed(undefined)),
                )
              : graph.scopeProjections?.[inNodeId] !== undefined
                ? yield* endpointIO(project, graph, inNodeId).pipe(
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
        const { cache: pastedWildcards, result } = yield* graphWildcards(
          {
            ...proposedGraph,
            connections: [...graph.connections, ...connections],
          },
          nodeIO,
        );
        if (Result.isFailure(result))
          return yield* new Clipboard.InvalidError({ reason: result.failure[0]!.reason });
        for (const node of nodes) {
          const resolved = pastedWildcards.resolveIO(node.id, nodeIO[node.id]!);
          for (const [input, value] of Object.entries(node.inputDefaults)) {
            const declared = nodeIO[node.id]!.dataInputs.find((port) => port.id === input);
            if (declared === undefined || !DataType.hasWildcard(declared.type)) continue;
            const port = resolved.dataInputs.find((port) => port.id === input)!;
            // Preserve a detached node's saved default for when it is reconnected.
            if (DataType.hasWildcard(port.type)) continue;
            yield* Schema.decodeUnknownEffect(DataType.JsonValueSchema(port.type, project.types))(
              value,
            ).pipe(
              Effect.catchTag(
                "SchemaError",
                () =>
                  new Clipboard.InvalidError({
                    reason: `${node.name}: ${input}: default does not match the inferred wildcard type`,
                  }),
              ),
            );
          }
        }
        return yield* events.publish({
          _tag: "FragmentPasted",
          graphId: options.graphID,
          nodes,
          scopeProjections,
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
        if (graph.scopeProjections?.[id] !== undefined) continue;
        if (!Object.hasOwn(graph.nodes, id)) return yield* new Node.NotFoundError({ id });
        const node = yield* Canvas.getNode(graph, id);
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
      const persistedNode = graph.nodes[options.nodeID];
      if (persistedNode === undefined) {
        if (graph.scopeProjections?.[options.nodeID] !== undefined) {
          if (options.name !== undefined)
            return yield* new Node.NotFoundError({ id: options.nodeID });
        } else {
          const project = yield* persistence.loadProject();
          const fn = project.functions[options.graphID];
          if (fn === undefined || !GraphFunction.isBoundaryNodeId(options.nodeID))
            return yield* new Node.NotFoundError({ id: options.nodeID });
          if (options.name !== undefined)
            return yield* new Node.NotFoundError({ id: options.nodeID });
        }
      }

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
      if (
        graph.nodes[options.nodeID] === undefined &&
        graph.scopeProjections?.[options.nodeID] === undefined
      )
        return yield* new Node.NotFoundError({ id: options.nodeID });
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

    const scopeProjectionCreate = Effect.fn("Editor.scopeProjection.create")(function* (options: {
      readonly graphID: string;
      readonly position: { readonly x: number; readonly y: number };
      readonly sourceNodeID: string;
      readonly sourceOutput: OutputRef.Model;
    }) {
      const graph = yield* persistence.loadGraph(options.graphID);
      const project = yield* persistence.loadProject();
      const sourceIO = yield* endpointIO(project, graph, options.sourceNodeID);
      const output = OutputRef.resolve(sourceIO, options.sourceOutput);
      if (
        options.sourceOutput._tag !== "Port" ||
        output?.kind !== "execution" ||
        output.port.scope == null
      )
        return yield* new Connection.InvalidError({ reason: "Output is not a bundled scope" });
      const id = NodeId.make(crypto.randomUUID());
      const projection: Scopes.Projection = { id, position: options.position };
      const connection: Connection.Model = {
        id: Connection.ConnectionId.make(crypto.randomUUID()),
        outNodeId: options.sourceNodeID,
        outIo: options.sourceOutput,
        inNodeId: id,
        inIoId: Scopes.ProjectionInputId,
      };
      const candidate = {
        ...graph,
        scopeProjections: { ...graph.scopeProjections, [id]: projection },
        connections: [...graph.connections, connection],
      };
      const io = Scopes.projectionIO(candidate, id, (nodeId) =>
        nodeId === options.sourceNodeID ? sourceIO : undefined,
      );
      return yield* events.publish({
        _tag: "ScopeProjectionCreated",
        graphId: options.graphID,
        projection,
        node: Scopes.projectionNode(projection),
        connection,
        io,
      });
    }, lock.withPermit);

    const nodeSetScopeSplit = Effect.fn("Editor.node.setScopeSplit")(function* (
      options: NodeSetScopeSplitOptions,
    ) {
      const graph = yield* persistence.loadGraph(options.graphID);
      const node = yield* Canvas.getNode(graph, options.nodeID);
      const io = yield* getNodeIO(node);
      const port = OutputRef.resolve(io, OutputRef.port(options.scope));
      if (port?.kind !== "execution" || port.port.scope == null)
        return yield* new Connection.InvalidError({ reason: "Output is not a scope" });
      const split = new Set(node.splitScopeOutputs ?? []);
      if (
        split.has(IoId.make(options.scope)) !== options.split &&
        graph.connections.some(
          (wire) => wire.outNodeId === node.id && OutputRef.parentId(wire.outIo) === options.scope,
        )
      )
        return yield* new Connection.InvalidError({
          reason: "Disconnect this scope's output wires before changing its display mode",
        });
      if (options.split) split.add(IoId.make(options.scope));
      else split.delete(IoId.make(options.scope));
      return yield* events.publish({
        _tag: "NodeScopeSplitChanged",
        graphId: options.graphID,
        nodeId: node.id,
        splitScopeOutputs: [...split],
      });
    }, lock.withPermit);

    const nodeSetFoldPins = Effect.fn("Editor.node.setFoldPins")(function* (
      options: NodeSetFoldPinsOptions,
    ) {
      const graph = yield* persistence.loadGraph(options.graphID);
      yield* Canvas.getNode(graph, options.nodeID);
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
      const node = yield* Canvas.getNode(graph, options.nodeID);
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
      yield* validateQueueTarget({ schema: node.schema, properties });
      const updated: Node.Model = {
        ...node,
        properties,
      };
      const io = yield* getNodeIO(updated);
      const project = yield* persistence.loadProject();
      const definitions = project.types;
      const oldIO = yield* getNodeIO(node);
      const preservesTypeData =
        node.schema.package === CustomTypes.packageId ||
        [...oldIO.dataInputs, ...oldIO.dataOutputs, ...io.dataInputs, ...io.dataOutputs].some(
          (port) =>
            TypeDefinition.references(port.type).length > 0 || DataType.hasWildcard(port.type),
        ) ||
        TypeDefinition.valueReferences(node.properties).length > 0 ||
        TypeDefinition.valueReferences(node.inputDefaults).length > 0 ||
        TypeDefinition.nodeDiagnostics(node, oldIO, definitions).length > 0;
      const inputDefaults = preservesTypeData
        ? node.inputDefaults
        : yield* retainValidInputDefaults(io, node.inputDefaults);
      const fn = project.functions[graph.id];

      const stale: Array<Connection.Model> = [];
      for (const connection of graph.connections) {
        if (connection.inNodeId !== node.id && connection.outNodeId !== node.id) continue;
        const outputNode = graph.nodes[connection.outNodeId];
        const inputNode = graph.nodes[connection.inNodeId];
        const outputIO =
          outputNode?.id === node.id
            ? io
            : outputNode !== undefined
              ? yield* getNodeIO(outputNode)
              : fn === undefined
                ? undefined
                : GraphFunction.boundaryIO(fn, connection.outNodeId);
        const inputIO =
          inputNode?.id === node.id
            ? io
            : inputNode !== undefined
              ? yield* getNodeIO(inputNode)
              : fn === undefined
                ? undefined
                : GraphFunction.boundaryIO(fn, connection.inNodeId);
        if (outputIO === undefined || inputIO === undefined) {
          stale.push(connection);
          continue;
        }
        if (!isConnectionValid(connection, outputIO, inputIO)) stale.push(connection);
      }
      const { result } = yield* graphWildcards(
        {
          ...graph,
          connections: graph.connections.filter((wire) => !stale.includes(wire)),
        },
        { [node.id]: io },
      );
      const conflicts = new Set(
        Result.isFailure(result) ? result.failure.map((conflict) => conflict.connectionId) : [],
      );
      stale.push(...graph.connections.filter((wire) => conflicts.has(wire.id)));
      return yield* events.publish({
        _tag: "NodePropertyUpdated",
        graphId: options.graphID,
        nodeId: options.nodeID,
        property: options.property,
        properties,
        inputDefaults,
        deletedConnectionIds: (node.schema.package === CustomTypes.packageId &&
        CustomTypes.operationFor(node.schema.schema) !== undefined
          ? []
          : stale
        )
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
      const node = yield* Canvas.getNode(graph, options.nodeID);
      const ioProperties = yield* resolveIOProperties(node.schema, node.properties);
      const { cache, declarations, result } = yield* graphWildcards(graph);
      const definitions = (yield* persistence.loadProject()).types;
      const declaredIO = declarations.get(node.id) ?? emptyNodeIO;
      // Invalid persisted graphs must not use inference from the last valid snapshot.
      const resolved = Result.isFailure(result) ? declaredIO : cache.resolveIO(node.id, declaredIO);
      const input = resolved.dataInputs.find((port) => port.id === options.input);
      const declared = declarations
        .get(node.id)
        ?.dataInputs.find((port) => port.id === options.input);
      if (
        declared !== undefined &&
        DataType.hasWildcard(declared.type) &&
        (resolved.dataInputs.filter((port) => port.id === options.input).length !== 1 ||
          resolved.executionInputs.some((port) => port.id === options.input))
      )
        return yield* new Package.InvalidInputDefaultError({
          input: options.input,
          reason: "Input is not an unambiguous data input",
        });
      const value =
        input !== undefined
          ? yield* Schema.decodeUnknownEffect(DataType.JsonValueSchema(input.type, definitions))(
              options.value,
              { onExcessProperty: "error" },
            ).pipe(
              Effect.catchTag("SchemaError", () =>
                Schema.decodeUnknownEffect(DataType.ValueSchema(input.type, definitions))(
                  options.value,
                ),
              ),
              Effect.flatMap((value) =>
                Schema.encodeUnknownEffect(DataType.JsonValueSchema(input.type, definitions))(
                  value,
                ),
              ),
              Effect.catchTag(
                "SchemaError",
                () =>
                  new Package.InvalidInputDefaultError({
                    input: options.input,
                    reason: "Default does not match the inferred wildcard type",
                  }),
              ),
            )
          : yield* packages.validateInputDefault(
              node.schema,
              ioProperties,
              options.input,
              options.value,
              (yield* persistence.loadProject()).types,
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
      const node = yield* Canvas.getNode(graph, options.nodeID);
      const io = Object.hasOwn(node.inputDefaults, options.input)
        ? undefined
        : yield* getNodeIO(node);
      if (
        io !== undefined &&
        (io.dataInputs.filter((port) => port.id === options.input).length !== 1 ||
          io.executionInputs.some((port) => port.id === options.input))
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
      const { node, properties, definitions } = yield* Effect.gen(function* () {
        const graph = yield* persistence.loadGraph(options.graphID);
        const node = yield* Canvas.getNode(graph, options.nodeID);
        const properties = yield* resolveIOProperties(node.schema, node.properties);
        return { node, properties, definitions: (yield* persistence.loadProject()).types };
      }).pipe(lock.withPermit);
      // Live resolvers can update engine storage, which also acquires the editor lock.
      return yield* packages.getSuggestions(
        node.schema,
        properties,
        node.inputDefaults,
        options.input,
        definitions,
      );
    });

    const connectionCreate = Effect.fn("Editor.connection.create")(function* (options: {
      readonly graphID: string;
      readonly connection: Connection.CreateInput;
    }) {
      const graph = yield* persistence.loadGraph(options.graphID);
      const project = yield* persistence.loadProject();
      const outSchema = yield* endpointIO(project, graph, options.connection.outNodeId);
      const inSchema = yield* endpointIO(project, graph, options.connection.inNodeId);

      const output = OutputRef.resolve(outSchema, options.connection.outIo);
      const executionOutputs = output?.kind === "execution" ? [output.port] : [];
      const dataOutputs = output?.kind === "data" ? [output.port] : [];
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
      if (
        (executionOutputs.length === 0) !== (executionInputs.length === 0) ||
        (executionOutputs.length === 1 &&
          !Registration.scopesCompatible(executionOutputs[0]!.scope, executionInputs[0]!.scope))
      )
        return yield* new Connection.InvalidError({
          reason: "Connection endpoints must have the same IO kind",
        });
      if (
        dataOutputs[0] !== undefined &&
        dataInputs[0] !== undefined &&
        !DataType.compatible(dataOutputs[0].type, dataInputs[0].type)
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
      const { result } = yield* graphWildcards({
        ...graph,
        connections: [...graph.connections, connection],
      });
      if (Result.isFailure(result))
        return yield* new Connection.InvalidError({ reason: result.failure[0]!.reason });
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
      const project = yield* persistence.loadProject();
      yield* packages.setTypeDefinitions(project.types);
      return project;
    }, lock.withPermit);

    const projectSnapshot = Effect.fn("Editor.project.snapshot")(function* () {
      const project = yield* persistence.loadProject();
      yield* packages.setTypeDefinitions(project.types);
      const generated: Record<string, Record<string, NodeIO>> = {};
      const graphs: Record<string, Canvas.Model> = {};
      for (const [graphId, persistedGraph] of Object.entries(Project.canvases(project))) {
        const fn = project.functions[graphId];
        const graph = Scopes.projectCanvas(
          fn === undefined ? persistedGraph : GraphFunction.projectCanvas(fn),
        );
        graphs[graphId] = graph;
        generated[graphId] = {};
        for (const node of Object.values(graph.nodes)) {
          const io = yield* getNodeIO(node).pipe(
            Effect.catchTag("SchemaNotFoundError", () => Effect.succeed(undefined)),
          );
          if (io !== undefined) generated[graphId][node.id] = io;
        }
        if (fn !== undefined) {
          generated[graphId][GraphFunction.InputBoundaryNodeId] = GraphFunction.boundaryIO(
            fn,
            GraphFunction.InputBoundaryNodeId,
          )!;
          generated[graphId][GraphFunction.OutputBoundaryNodeId] = GraphFunction.boundaryIO(
            fn,
            GraphFunction.OutputBoundaryNodeId,
          )!;
        }
      }
      return { project: { ...project, graphs }, nodeIO: generated };
    }, lock.withPermit);

    const projectRendered = Effect.fn("Editor.project.rendered")(function* () {
      const project = yield* persistence.loadProject();
      yield* packages.setTypeDefinitions(project.types);
      const graphs: Record<string, RenderedProject.Model["graphs"][string]> = {};
      for (const [graphId, graph] of Object.entries(Project.canvases(project))) {
        const fn = project.functions[graphId];
        const projectedGraph = Scopes.projectCanvas(graph);
        const nodes: Record<string, RenderedProject.Model["graphs"][string]["nodes"][string]> = {};
        const { cache, declarations, result } = yield* graphWildcards(graph);
        const schemas: Record<string, Record<string, Package.SchemaModel>> = {};
        for (const node of Object.values(projectedGraph.nodes)) {
          const schema = Scopes.isProjectionNode(node)
            ? undefined
            : yield* packages
                .getSchema(node.schema)
                .pipe(
                  Effect.catchTag("SchemaNotFoundError", (error) =>
                    node.schema.package === CustomTypes.packageId
                      ? Effect.succeed(undefined)
                      : Effect.fail(error),
                  ),
                );
          nodes[node.id] = {
            ...node,
            io: Result.isFailure(result)
              ? (declarations.get(node.id) ?? emptyNodeIO)
              : cache.resolveIO(node.id, declarations.get(node.id) ?? emptyNodeIO),
          };
          if (schema !== undefined)
            (schemas[node.schema.package] ??= {})[node.schema.schema] = schema;
        }
        if (fn !== undefined)
          for (const node of GraphFunction.boundaryNodes(fn))
            nodes[node.id] = {
              ...node,
              io: GraphFunction.boundaryIO(fn, node.id)!,
            };
        graphs[graphId] = { ...projectedGraph, nodes, schemas };
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

    const queueCreate = Effect.fn("Editor.queue.create")(function* (name: string) {
      const id = Queue.QueueId.make(crypto.randomUUID());
      return yield* events.publish({ _tag: "QueueUpdated", queue: { id, name } });
    }, lock.withPermit);
    const getQueue = Effect.fnUntraced(function* (id: string) {
      const queue = (yield* persistence.loadProject()).queues[id];
      if (queue === undefined) return yield* new Queue.NotFoundError({ id });
      return queue;
    });
    const queueRename = Effect.fn("Editor.queue.rename")(function* (id: string, name: string) {
      const queue = yield* getQueue(id);
      return yield* events.publish({ _tag: "QueueUpdated", queue: { ...queue, name } });
    }, lock.withPermit);
    const queueDelete = Effect.fn("Editor.queue.delete")(function* (id: string) {
      yield* getQueue(id);
      return yield* events.publish({ _tag: "QueueDeleted", queueId: id });
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
      for (const [graphId, graph] of Object.entries(Project.canvases(project))) {
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
      for (const graph of Object.values(Project.canvases(project))) {
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
      moduleId: string,
      state: unknown,
    ) {
      const definition = (yield* Ref.get(engines)).get(moduleId);
      if (definition === undefined) return yield* new EngineNotRegistered({ moduleId });
      const decoded = yield* Schema.decodeUnknownEffect(definition.Storage)(state).pipe(
        Effect.mapError((cause) => new InvalidEngineState({ moduleId, cause })),
      );
      const encoded = yield* Schema.encodeUnknownEffect(definition.Storage)(decoded).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
        Effect.mapError((cause) => new InvalidEngineState({ moduleId, cause })),
      );
      return yield* events.publish({ _tag: "EngineStateChanged", moduleId, state: encoded });
    }, lock.withPermit);

    const module: Interface["module"] = (...args) =>
      Effect.gen(function* () {
        const [definition, deployment] = args;
        if (
          definition.engine !== undefined &&
          (deployment === undefined ||
            deployment.moduleId !== definition.id ||
            deployment.definition !== definition.engine)
        )
          return yield* Effect.die(`Deployment does not match module ${definition.id}`);
        const schemas = yield* Registration.collect(definition.effect);
        const resources = definition.engine?.Resource ?? [];
        const resourceIds = new Set<string>();
        for (const resource of resources) {
          if (resourceIds.has(resource.key))
            return yield* Effect.die(
              `Module ${definition.id} registers duplicate resource ${resource.key}`,
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
        const definitions = yield* persistence.loadProject().pipe(
          Effect.map((project) => project.types),
          Effect.catchTag("ProjectNotFoundError", () => Effect.succeed({})),
          Effect.orDie,
        );
        const encodeValue = (
          type: DataType.Any,
          value: unknown,
          definitions: DataType.Definitions,
        ): Schema.Json =>
          Schema.decodeUnknownSync(Schema.Json)(
            Schema.encodeUnknownSync(DataType.JsonDefaultSchema(type, definitions))(value),
          );
        const pkg: Package.Model = {
          id: PackageId.make(definition.id),
          name: definition.name ?? definition.id,
          ...(definition.description === undefined ? {} : { description: definition.description }),
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
                      : {
                          defaultValue: encodeValue(
                            property.type,
                            property.defaultValue,
                            definitions,
                          ),
                        }),
                  },
            ),
            dataInputs: schema.dataInputs.map((input) => ({
              id: IoId.make(input.id),
              type: input.type,
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(input.defaultValue === undefined
                ? {}
                : { defaultValue: encodeValue(input.type, input.defaultValue, definitions) }),
              ...(input.suggestions === undefined ? {} : { suggestions: true }),
            })),
            dataOutputs: schema.dataOutputs.map((output) => ({
              id: IoId.make(output.id),
              type: output.type,
              ...(output.name === undefined ? {} : { name: output.name }),
            })),
            executionInputs: schema.executionInputs.map(Scopes.executionPort),
            executionOutputs: schema.executionOutputs.map(Scopes.executionPort),
          })),
        };
        yield* packages.loadPackage(
          pkg,
          new Map(
            schemas.map((schema) => [
              schema.id,
              {
                declaresProperties: true,
                getIO: (
                  properties: Readonly<Record<string, unknown>>,
                  definitions: DataType.Definitions,
                ): NodeIO => {
                  const io = schema.generateIO(properties);
                  return {
                    dataInputs: io.dataInputs.map((input) => {
                      // Invalid schema fallback defaults must not prevent rendering repairable nodes.
                      // Persisted user defaults are separate and are never changed here.
                      const encoded =
                        input.defaultValue === undefined
                          ? undefined
                          : Schema.encodeUnknownResult(
                              DataType.JsonDefaultSchema(input.type, definitions),
                            )(input.defaultValue);
                      return {
                        id: IoId.make(input.id),
                        type: input.type,
                        ...(input.name === undefined ? {} : { name: input.name }),
                        ...(encoded === undefined || encoded._tag === "Failure"
                          ? {}
                          : {
                              defaultValue: encoded.success,
                            }),
                        ...(input.suggestions === undefined ? {} : { suggestions: true }),
                      };
                    }),
                    dataOutputs: io.dataOutputs.map((output) => ({
                      id: IoId.make(output.id),
                      type: output.type,
                      ...(output.name === undefined ? {} : { name: output.name }),
                    })),
                    executionInputs: io.executionInputs.map(Scopes.executionPort),
                    executionOutputs: io.executionOutputs.map(Scopes.executionPort),
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
      typeDefinition: { preview: typePreview, confirm: typeConfirm },
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
      queue: { create: queueCreate, rename: queueRename, delete: queueDelete },
      graph: { create: graphCreate, update: graphUpdate, delete: graphDelete },
      function: {
        create: functionCreate,
        addField: functionAddField,
        updateField: functionUpdateField,
        reorderField: functionReorderField,
        deleteField: functionDeleteField,
      },
      node: {
        create: nodeCreate,
        update: nodeUpdate,
        setFoldPins: nodeSetFoldPins,
        setScopeSplit: nodeSetScopeSplit,
        setProperty: nodeSetProperty,
        clearProperty: nodeClearProperty,
        setInputDefault: nodeSetInputDefault,
        clearInputDefault: nodeClearInputDefault,
        getInputSuggestions: nodeGetInputSuggestions,
        delete: nodeDelete,
      },
      scopeProjection: { create: scopeProjectionCreate },
      connection: { create: connectionCreate, delete: connectionDelete },
      engine: {
        setState: engineSetState,
        getEndpoints: () => Ref.get(engineEndpoints),
        setEndpoints: (endpoints) => Ref.set(engineEndpoints, endpoints),
        hostClientState: (moduleId, state) =>
          Ref.update(engineClientStates, (current) => {
            const next = new Map(current);
            next.set(moduleId, state);
            return next;
          }),
        getClientState: (moduleId) =>
          Ref.get(engineClientStates).pipe(
            Effect.flatMap((states) => {
              const state = states.get(moduleId);
              return state === undefined ? new EngineNotHosted({ moduleId }) : state;
            }),
          ),
        dirtyClientState: (moduleId) =>
          events.publishEphemeral({ _tag: "ModuleClientStateDirty", moduleId }).pipe(Effect.asVoid),
        getClientCapabilities: () =>
          Ref.get(engineClientStates).pipe(
            Effect.map((states) => Array.from(states.keys()).sort()),
          ),
        hostResource: (moduleId, resourceId, resource) =>
          Effect.gen(function* () {
            const forwardingFiber = yield* resource.changes.pipe(
              Stream.runForEach((values) =>
                events.publishEphemeral({
                  _tag: "ResourceValuesUpdated",
                  package: moduleId,
                  resource: resourceId,
                  values,
                }),
              ),
              Effect.forkIn(scope),
            );
            const previous = yield* Ref.modify(hostedResources, (current) => {
              const key = resourceKey(moduleId, resourceId);
              return [
                current.get(key),
                new Map(current).set(key, { ...resource, forwardingFiber }),
              ];
            });
            if (previous !== undefined) yield* Fiber.interrupt(previous.forwardingFiber);
          }),
        getResourceValues: (moduleId, resourceId) =>
          Ref.get(hostedResources).pipe(
            Effect.flatMap((resources) => {
              const resource = resources.get(resourceKey(moduleId, resourceId));
              return resource === undefined
                ? new ResourceConstant.InvalidResourceError({
                    package: moduleId,
                    resource: resourceId,
                    reason: "Resource engine is not hosted",
                  })
                : resource.values;
            }),
          ),
        reloadResource: (moduleId, resourceId) =>
          Ref.get(hostedResources).pipe(
            Effect.flatMap((resources) => {
              const resource = resources.get(resourceKey(moduleId, resourceId));
              return resource === undefined
                ? new ResourceConstant.InvalidResourceError({
                    package: moduleId,
                    resource: resourceId,
                    reason: "Resource engine is not hosted",
                  })
                : resource.reload;
            }),
          ),
        hostRuntimeClient: (moduleId, client) =>
          Ref.update(runtimeClients, (current) => new Map(current).set(moduleId, client)),
        getRuntimeClient: (moduleId) =>
          Ref.get(runtimeClients).pipe(
            Effect.flatMap((clients) => {
              const client = clients.get(moduleId);
              return client === undefined
                ? new EngineNotHosted({ moduleId })
                : Effect.succeed(client);
            }),
          ),
      },
      module,
    });
  }),
);

export const defaultLayer = layer.pipe(Layer.provideMerge(EditorEvents.defaultLayer));

export * as Editor from "./Editor.ts";
