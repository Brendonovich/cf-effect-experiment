import {
  Connection,
  Graph,
  Node,
  Package as PkgTypes,
  Policy,
  Project,
  ResourceConstant,
} from "@macrograph/core";
import { PersistenceError } from "@macrograph/persistence";
import { Credential } from "@macrograph/plugin/Credential";
import * as Engine from "@macrograph/plugin/Engine";
import * as HttpEndpoint from "@macrograph/plugin/HttpEndpoint";
import { Effect, Layer, Schema, Stream } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc";

import * as Editor from "./Editor.ts";
import { EditorAccess } from "./EditorAccess.ts";
import { EditorEvent } from "./EditorEvent.ts";
import { EditorEvents } from "./EditorEvents.ts";
import { Packages } from "./Packages.ts";
import { Presence } from "./Presence.ts";

/** Resolves and authorizes editor RPC connections while attributing their events. */
export class ConnectionMiddleware extends RpcMiddleware.Service<
  ConnectionMiddleware,
  { provides: EditorAccess.Connection; requires: EditorAccess.Policy }
>()("macrograph/EditorConnectionMiddleware", { error: EditorAccess.Forbidden }) {}

const readOnlyRpcs = new Set([
  "GetProject",
  "GetInputSuggestions",
  "GetPackages",
  "GetIngressEndpoints",
  "GetPluginClientState",
  "GetPluginSettingsCapabilities",
  "GetResourceValues",
  "GetCredentialCatalog",
  "GetCredentialAuth",
  "ProjectEventsStream",
  "PresenceStream",
  "UpdatePresence",
]);

export const requiresWriteAccess = (operation: string) => !readOnlyRpcs.has(operation);

const credentialMutations = new Set([
  "RefetchCredentials",
  "StartCredentialAuth",
  "PollCredentialAuth",
  "DisconnectCredentialAuth",
]);

export const authorize = (
  identity: EditorAccess.ConnectionIdentity,
  operation: string,
): Effect.Effect<void, EditorAccess.Forbidden> =>
  credentialMutations.has(operation)
    ? !identity.canManageCredentials
      ? new EditorAccess.Forbidden({ operation })
      : Effect.void
    : requiresWriteAccess(operation) && !identity.canEdit
      ? new EditorAccess.Forbidden({ operation })
      : Effect.void;

export const isEventVisibleTo = (event: EditorEvent.EditorEvent, connectionId: string) =>
  event.actor.type === "SYSTEM" || event.actor.id !== connectionId;

// Persisted engine state may contain credentials; public updates only invalidate client state.
export const publicEvent = (event: EditorEvent.EditorEvent): EditorEvent.EditorEvent =>
  event._tag === "EngineStateChanged"
    ? { _tag: "PluginClientStateDirty", actor: event.actor, pluginId: event.pluginId }
    : event;

export const connectionMiddlewareLayer = Layer.effect(ConnectionMiddleware)(
  Effect.gen(function* () {
    const policy = yield* EditorAccess.Policy;
    const events = yield* EditorEvents.Service;
    return ConnectionMiddleware.of((effect, options) =>
      Effect.gen(function* () {
        const identity = yield* policy.resolve(options.headers, options.client.id);
        return yield* events
          .withActor(
            Effect.provideService(effect, EditorAccess.Connection, identity),
            identity.actor,
          )
          .pipe(Policy.withPolicy(authorize(identity, options.rpc._tag)));
      }),
    );
  }),
);

const SnapshotErrors = Schema.Union([PersistenceError, Project.NotFoundError]);

const PersistenceGraphAndNodeErrors = Schema.Union([
  PersistenceError,
  Project.NotFoundError,
  Graph.NotFoundError,
  Node.NotFoundError,
]);
const ConnectionErrors = Schema.Union([
  PersistenceError,
  Project.NotFoundError,
  Graph.NotFoundError,
  Node.NotFoundError,
  PkgTypes.SchemaNotFoundError,
  Connection.InvalidError,
]);

class CreateGraph extends Rpc.make("CreateGraph", {
  payload: { graph: Graph.CreateInput },
  success: EditorEvent.GraphCreated,
  error: PersistenceError,
}) {}

class GetProject extends Rpc.make("GetProject", {
  payload: {},
  success: Project.Model,
  error: SnapshotErrors,
}) {}

class DeleteGraph extends Rpc.make("DeleteGraph", {
  payload: { graphId: Schema.String },
  success: EditorEvent.GraphDeleted,
  error: PersistenceError,
}) {}

class SetGraphName extends Rpc.make("SetGraphName", {
  payload: { graphId: Schema.String, name: Schema.String },
  success: EditorEvent.GraphNameChanged,
  error: Schema.Union([PersistenceError, Graph.NotFoundError]),
}) {}

class CreateNode extends Rpc.make("CreateNode", {
  payload: { graphId: Schema.String, node: Node.CreateInput },
  success: EditorEvent.NodeCreated,
  error: Schema.Union([
    PersistenceError,
    Project.NotFoundError,
    Graph.NotFoundError,
    PkgTypes.SchemaNotFoundError,
    PkgTypes.InvalidPropertyError,
    PkgTypes.InvalidInputDefaultError,
  ]),
}) {}

class DeleteNode extends Rpc.make("DeleteNode", {
  payload: { graphId: Schema.String, nodeId: Schema.String },
  success: EditorEvent.NodeDeleted,
  error: PersistenceGraphAndNodeErrors,
}) {}

class SetNodeName extends Rpc.make("SetNodeName", {
  payload: {
    graphId: Schema.String,
    nodeId: Schema.String,
    name: Schema.String,
  },
  success: EditorEvent.NodeNameChanged,
  error: PersistenceGraphAndNodeErrors,
}) {}

class SetNodePosition extends Rpc.make("SetNodePosition", {
  payload: {
    graphId: Schema.String,
    nodeId: Schema.String,
    x: Schema.Number,
    y: Schema.Number,
    ephemeral: Schema.optional(Schema.Boolean),
  },
  success: EditorEvent.NodePositionChanged,
  error: PersistenceGraphAndNodeErrors,
}) {}

class SetNodeFoldPins extends Rpc.make("SetNodeFoldPins", {
  payload: {
    graphId: Schema.String,
    nodeId: Schema.String,
    foldPins: Schema.Boolean,
  },
  success: EditorEvent.NodeFoldPinsChanged,
  error: PersistenceGraphAndNodeErrors,
}) {}

class SetNodeProperty extends Rpc.make("SetNodeProperty", {
  payload: {
    graphId: Schema.String,
    nodeId: Schema.String,
    property: Schema.String,
    value: Schema.Json,
  },
  success: EditorEvent.NodePropertyUpdated,
  error: Schema.Union([
    PersistenceError,
    Project.NotFoundError,
    Graph.NotFoundError,
    Node.NotFoundError,
    PkgTypes.SchemaNotFoundError,
    PkgTypes.InvalidPropertyError,
  ]),
}) {}

class ClearNodeProperty extends Rpc.make("ClearNodeProperty", {
  payload: {
    graphId: Schema.String,
    nodeId: Schema.String,
    property: Schema.String,
  },
  success: EditorEvent.NodePropertyUpdated,
  error: Schema.Union([
    PersistenceError,
    Project.NotFoundError,
    Graph.NotFoundError,
    Node.NotFoundError,
    PkgTypes.SchemaNotFoundError,
    PkgTypes.InvalidPropertyError,
  ]),
}) {}

class SetInputDefault extends Rpc.make("SetInputDefault", {
  payload: {
    graphId: Schema.String,
    nodeId: Schema.String,
    input: Schema.String,
    value: Schema.Json,
  },
  success: EditorEvent.InputDefaultUpdated,
  error: Schema.Union([
    PersistenceError,
    Project.NotFoundError,
    Graph.NotFoundError,
    Node.NotFoundError,
    PkgTypes.SchemaNotFoundError,
    PkgTypes.InvalidInputDefaultError,
  ]),
}) {}

class ClearInputDefault extends Rpc.make("ClearInputDefault", {
  payload: { graphId: Schema.String, nodeId: Schema.String, input: Schema.String },
  success: EditorEvent.InputDefaultUpdated,
  error: Schema.Union([
    PersistenceError,
    Project.NotFoundError,
    Graph.NotFoundError,
    Node.NotFoundError,
    PkgTypes.SchemaNotFoundError,
    PkgTypes.InvalidInputDefaultError,
  ]),
}) {}

class GetInputSuggestions extends Rpc.make("GetInputSuggestions", {
  payload: { graphId: Schema.String, nodeId: Schema.String, input: Schema.String },
  success: Schema.Array(Schema.String),
  error: Schema.Union([
    PersistenceError,
    Project.NotFoundError,
    Graph.NotFoundError,
    Node.NotFoundError,
    PkgTypes.SchemaNotFoundError,
    PkgTypes.InvalidInputDefaultError,
  ]),
}) {}

class CreateConnection extends Rpc.make("CreateConnection", {
  payload: { graphId: Schema.String, connection: Connection.CreateInput },
  success: EditorEvent.ConnectionCreated,
  error: ConnectionErrors,
}) {}

class DeleteConnection extends Rpc.make("DeleteConnection", {
  payload: { graphId: Schema.String, connectionId: Schema.String },
  success: EditorEvent.ConnectionDeleted,
  error: PersistenceError,
}) {}

class LoadPackage extends Rpc.make("LoadPackage", {
  payload: { pkg: PkgTypes.Model },
  success: Schema.Void,
}) {}

class GetPackages extends Rpc.make("GetPackages", {
  payload: {},
  success: Schema.Array(PkgTypes.Model),
}) {}

class SetEngineState extends Rpc.make("SetEngineState", {
  payload: { pluginId: Schema.String, state: Schema.Json },
  success: EditorEvent.EngineStateChanged,
  error: Schema.Union([PersistenceError, Editor.EngineNotRegistered, Editor.InvalidEngineState]),
}) {}

class GetIngressEndpoints extends Rpc.make("GetIngressEndpoints", {
  payload: {},
  success: Schema.Array(HttpEndpoint.Routed),
}) {}

class GetPluginClientState extends Rpc.make("GetPluginClientState", {
  payload: { pluginId: Schema.String },
  success: Schema.Json,
  error: Editor.EngineNotHosted,
}) {}

class GetPluginSettingsCapabilities extends Rpc.make("GetPluginSettingsCapabilities", {
  success: Schema.Array(
    Schema.Struct({
      pluginId: Schema.String,
      availability: Schema.Literal("available"),
    }),
  ),
}) {}

class CreateResourceConstant extends Rpc.make("CreateResourceConstant", {
  payload: { resource: ResourceConstant.ResourceRef },
  success: EditorEvent.ResourceConstantCreated,
  error: Schema.Union([
    PersistenceError,
    Project.NotFoundError,
    ResourceConstant.InvalidResourceError,
  ]),
}) {}

class RenameResourceConstant extends Rpc.make("RenameResourceConstant", {
  payload: { constantId: Schema.String, name: Schema.String },
  success: EditorEvent.ResourceConstantUpdated,
  error: Schema.Union([PersistenceError, Project.NotFoundError, ResourceConstant.NotFoundError]),
}) {}

class SelectResourceConstant extends Rpc.make("SelectResourceConstant", {
  payload: { constantId: Schema.String, value: Schema.Json },
  success: EditorEvent.ResourceConstantUpdated,
  error: Schema.Union([
    PersistenceError,
    Project.NotFoundError,
    ResourceConstant.NotFoundError,
    ResourceConstant.InvalidResourceError,
  ]),
}) {}

class DeleteResourceConstant extends Rpc.make("DeleteResourceConstant", {
  payload: { constantId: Schema.String },
  success: EditorEvent.ResourceConstantDeleted,
  error: Schema.Union([
    PersistenceError,
    Project.NotFoundError,
    ResourceConstant.NotFoundError,
    ResourceConstant.InUseError,
  ]),
}) {}

class SetDefaultResourceConstant extends Rpc.make("SetDefaultResourceConstant", {
  payload: { constantId: Schema.String },
  success: EditorEvent.ResourceConstantDefaultChanged,
  error: Schema.Union([PersistenceError, Project.NotFoundError, ResourceConstant.NotFoundError]),
}) {}

class GetResourceValues extends Rpc.make("GetResourceValues", {
  payload: ResourceConstant.ResourceRef,
  success: Schema.Array(ResourceConstant.LiveValue),
  error: ResourceConstant.InvalidResourceError,
}) {}

class ReloadResource extends Rpc.make("ReloadResource", {
  payload: ResourceConstant.ResourceRef,
  success: Schema.Void,
  error: ResourceConstant.InvalidResourceError,
}) {}

class GetCredentialCatalog extends Rpc.make("GetCredentialCatalog", {
  success: Credential.Catalog,
}) {}

class RefetchCredentials extends Rpc.make("RefetchCredentials", {
  success: Credential.Catalog,
}) {}

class GetCredentialAuth extends Rpc.make("GetCredentialAuth", {
  success: Schema.NullOr(Credential.AuthState),
  error: Credential.AuthError,
}) {}

class StartCredentialAuth extends Rpc.make("StartCredentialAuth", {
  success: Credential.AuthState,
  error: Credential.AuthError,
}) {}

class PollCredentialAuth extends Rpc.make("PollCredentialAuth", {
  success: Credential.AuthState,
  error: Credential.AuthError,
}) {}

class DisconnectCredentialAuth extends Rpc.make("DisconnectCredentialAuth", {
  success: Schema.Void,
  error: Credential.AuthError,
}) {}

const ProjectEventsStream = Rpc.make("ProjectEventsStream", {
  error: SnapshotErrors,
  success: Schema.Union([
    Schema.TaggedStruct("ProjectSnapshot", { snapshot: Editor.ProjectSnapshot }),
    EditorEvent.GraphCreated,
    EditorEvent.GraphDeleted,
    EditorEvent.GraphNameChanged,
    EditorEvent.NodeCreated,
    EditorEvent.NodeDeleted,
    EditorEvent.NodeNameChanged,
    EditorEvent.NodePositionChanged,
    EditorEvent.NodeFoldPinsChanged,
    EditorEvent.NodePropertyUpdated,
    EditorEvent.InputDefaultUpdated,
    EditorEvent.ConnectionCreated,
    EditorEvent.ConnectionDeleted,
    EditorEvent.EngineStateChanged,
    EditorEvent.PluginClientStateDirty,
    EditorEvent.ResourceConstantCreated,
    EditorEvent.ResourceConstantDefaultChanged,
    EditorEvent.ResourceConstantUpdated,
    EditorEvent.ResourceConstantDeleted,
    EditorEvent.ResourceValuesUpdated,
  ]),
  stream: true,
});

class UpdatePresence extends Rpc.make("UpdatePresence", {
  payload: Presence.Update,
  success: Schema.Void,
  error: Presence.InvalidUpdate,
}) {}

const PresenceStream = Rpc.make("PresenceStream", {
  success: Schema.Union([Presence.Snapshot, Presence.Changed]),
  stream: true,
});

export const EditorRpcs = RpcGroup.make(
  CreateGraph,
  GetProject,
  DeleteGraph,
  SetGraphName,
  CreateNode,
  DeleteNode,
  SetNodeName,
  SetNodePosition,
  SetNodeFoldPins,
  SetNodeProperty,
  ClearNodeProperty,
  SetInputDefault,
  ClearInputDefault,
  GetInputSuggestions,
  CreateConnection,
  DeleteConnection,
  LoadPackage,
  GetPackages,
  SetEngineState,
  GetIngressEndpoints,
  GetPluginClientState,
  GetPluginSettingsCapabilities,
  CreateResourceConstant,
  RenameResourceConstant,
  SelectResourceConstant,
  DeleteResourceConstant,
  SetDefaultResourceConstant,
  GetResourceValues,
  ReloadResource,
  GetCredentialCatalog,
  RefetchCredentials,
  GetCredentialAuth,
  StartCredentialAuth,
  PollCredentialAuth,
  DisconnectCredentialAuth,
  ProjectEventsStream,
  UpdatePresence,
  PresenceStream,
).middleware(ConnectionMiddleware);

export const handlerLayer = EditorRpcs.toLayer(
  Effect.gen(function* () {
    const editor = yield* Editor.Service;
    const packages = yield* Packages.Service;
    const pubsub = yield* EditorEvents.Service;
    const presence = yield* Presence.Registry;
    const credentials = yield* Engine.Credentials;
    return EditorRpcs.of({
      CreateGraph: (payload) => editor.graph.create(payload.graph),
      GetProject: () =>
        Effect.gen(function* () {
          const identity = yield* EditorAccess.Connection;
          const project = yield* editor.project.get();
          return identity.canEdit ? project : { ...project, engines: {} };
        }),
      DeleteGraph: (payload) =>
        editor.graph
          .delete({ graphID: payload.graphId })
          .pipe(Effect.tap(() => presence.graphDeleted(payload.graphId))),
      SetGraphName: (payload) =>
        editor.graph.update({ graphID: payload.graphId, name: payload.name }),
      CreateNode: (payload) => editor.node.create({ graphID: payload.graphId, node: payload.node }),
      DeleteNode: (payload) =>
        editor.node
          .delete({ graphID: payload.graphId, nodeID: payload.nodeId })
          .pipe(Effect.tap(() => presence.nodeDeleted(payload.graphId, payload.nodeId))),
      SetNodeName: (payload) =>
        Effect.gen(function* () {
          const identity = yield* EditorAccess.Connection;
          yield* editor.node.update({
            graphID: payload.graphId,
            nodeID: payload.nodeId,
            name: payload.name,
          });
          return {
            _tag: "NodeNameChanged" as const,
            actor: identity.actor,
            graphId: payload.graphId,
            nodeId: payload.nodeId,
            name: payload.name,
          };
        }),
      SetNodePosition: (payload) =>
        Effect.gen(function* () {
          const identity = yield* EditorAccess.Connection;
          yield* editor.node.update({
            graphID: payload.graphId,
            nodeID: payload.nodeId,
            position: { x: payload.x, y: payload.y },
            ephemeral: payload.ephemeral ?? false,
          });
          return {
            _tag: "NodePositionChanged" as const,
            actor: identity.actor,
            graphId: payload.graphId,
            nodeId: payload.nodeId,
            x: payload.x,
            y: payload.y,
          };
        }),
      SetNodeFoldPins: (payload) =>
        editor.node.setFoldPins({
          graphID: payload.graphId,
          nodeID: payload.nodeId,
          foldPins: payload.foldPins,
        }),
      SetNodeProperty: (payload) =>
        editor.node.setProperty({
          graphID: payload.graphId,
          nodeID: payload.nodeId,
          property: payload.property,
          value: payload.value,
        }),
      ClearNodeProperty: (payload) =>
        editor.node.clearProperty({
          graphID: payload.graphId,
          nodeID: payload.nodeId,
          property: payload.property,
        }),
      SetInputDefault: (payload) =>
        editor.node.setInputDefault({
          graphID: payload.graphId,
          nodeID: payload.nodeId,
          input: payload.input,
          value: payload.value,
        }),
      ClearInputDefault: (payload) =>
        editor.node.clearInputDefault({
          graphID: payload.graphId,
          nodeID: payload.nodeId,
          input: payload.input,
        }),
      GetInputSuggestions: (payload) =>
        editor.node.getInputSuggestions({
          graphID: payload.graphId,
          nodeID: payload.nodeId,
          input: payload.input,
        }),
      CreateConnection: (payload) =>
        editor.connection.create({ graphID: payload.graphId, connection: payload.connection }),
      DeleteConnection: (payload) =>
        editor.connection.delete({
          graphID: payload.graphId,
          connectionId: payload.connectionId,
        }),
      LoadPackage: (payload) => packages.loadPackage(payload.pkg),
      GetPackages: () => packages.getPackages(),
      SetEngineState: ({ pluginId, state }) => editor.engine.setState(pluginId, state),
      GetIngressEndpoints: () => editor.engine.getEndpoints(),
      GetPluginClientState: ({ pluginId }) => editor.engine.getClientState(pluginId),
      GetPluginSettingsCapabilities: () =>
        editor.engine
          .getClientCapabilities()
          .pipe(
            Effect.map((pluginIds) =>
              pluginIds.map((pluginId) => ({ pluginId, availability: "available" as const })),
            ),
          ),
      CreateResourceConstant: ({ resource }) => editor.constant.create(resource),
      RenameResourceConstant: ({ constantId, name }) => editor.constant.rename(constantId, name),
      SelectResourceConstant: ({ constantId, value }) => editor.constant.select(constantId, value),
      DeleteResourceConstant: ({ constantId }) => editor.constant.delete(constantId),
      SetDefaultResourceConstant: ({ constantId }) => editor.constant.setDefault(constantId),
      GetResourceValues: ({ package: pluginId, resource }) =>
        editor.engine.getResourceValues(pluginId, resource),
      ReloadResource: ({ package: pluginId, resource }) =>
        editor.engine.reloadResource(pluginId, resource),
      GetCredentialCatalog: () =>
        credentials.catalog ??
        Effect.succeed(
          Credential.unavailable("no-provider", "No credential provider is configured."),
        ),
      RefetchCredentials: () =>
        credentials.refetch ??
        Effect.succeed(
          Credential.unavailable("no-provider", "No credential provider is configured."),
        ),
      GetCredentialAuth: () =>
        credentials.auth === undefined
          ? Effect.succeed(null)
          : credentials.auth.status.pipe(
              Effect.map((status) => ({ providerName: credentials.auth!.providerName, status })),
            ),
      StartCredentialAuth: () => {
        const auth = credentials.auth;
        return auth === undefined
          ? new Credential.AuthError({
              reason: "No credential authorization provider is configured",
            })
          : auth.start.pipe(Effect.map((status) => ({ providerName: auth.providerName, status })));
      },
      PollCredentialAuth: () => {
        const auth = credentials.auth;
        return auth === undefined
          ? new Credential.AuthError({
              reason: "No credential authorization provider is configured",
            })
          : auth.poll.pipe(Effect.map((status) => ({ providerName: auth.providerName, status })));
      },
      DisconnectCredentialAuth: () =>
        credentials.auth === undefined
          ? new Credential.AuthError({
              reason: "No credential authorization provider is configured",
            })
          : credentials.auth.disconnect,
      ProjectEventsStream: () =>
        Effect.gen(function* () {
          const identity = yield* EditorAccess.Connection;
          const subscription = yield* pubsub.subscribe;
          return Stream.fromEffect(editor.project.snapshot()).pipe(
            Stream.map((snapshot) => ({
              _tag: "ProjectSnapshot" as const,
              snapshot: identity.canEdit
                ? snapshot
                : {
                    ...snapshot,
                    project: { ...snapshot.project, engines: {} },
                  },
            })),
            Stream.concat(
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((event) => isEventVisibleTo(event, identity.connectionId)),
                Stream.map((event) => (identity.canEdit ? event : publicEvent(event))),
              ),
            ),
          );
        }).pipe(Stream.unwrap),
      UpdatePresence: (update) =>
        Effect.gen(function* () {
          if (update.activeGraph !== null) {
            const project = yield* editor.project.get();
            const graph = project.graphs[update.activeGraph];
            if (graph === undefined)
              return yield* new Presence.InvalidUpdate({ reason: "Graph does not exist" });
            if (update.selectedNodeIds.some((nodeId) => graph.nodes[nodeId] === undefined))
              return yield* new Presence.InvalidUpdate({
                reason: "Selection contains unknown nodes",
              });
          }
          yield* presence.update(update);
        }).pipe(
          Effect.catchTags({
            PersistenceError: () =>
              new Presence.InvalidUpdate({ reason: "Project is unavailable" }),
            ProjectNotFoundError: () =>
              new Presence.InvalidUpdate({ reason: "Project is unavailable" }),
          }),
        ),
      PresenceStream: () => Presence.stream,
    });
  }),
);

export * as EditorRpc from "./EditorRpc.ts";
