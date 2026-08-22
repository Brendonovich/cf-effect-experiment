import { Connection, Graph, Node, Package as PkgTypes, Project } from "@macrograph/core";
import { PersistenceError } from "@macrograph/persistence";
import { HttpEndpoint } from "@macrograph/plugin";
import { Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import * as Editor from "./Editor.ts";
import { EditorEvent } from "./EditorEvent.ts";
import { Packages } from "./Packages.ts";
import { ProjectPubSub } from "./ProjectPubSub.ts";

const ProjectAndPersistenceErrors = Schema.Union([PersistenceError, Project.NotFoundError]);

const PersistenceGraphAndNodeErrors = Schema.Union([
  PersistenceError,
  Graph.NotFoundError,
  Node.NotFoundError,
]);
const ConnectionErrors = Schema.Union([
  PersistenceError,
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
  error: ProjectAndPersistenceErrors,
}) {}

class DeleteGraph extends Rpc.make("DeleteGraph", {
  payload: { graphId: Schema.String },
  success: EditorEvent.GraphDeleted,
  error: PersistenceError,
}) {}

class CreateNode extends Rpc.make("CreateNode", {
  payload: { graphId: Schema.String, node: Node.CreateInput },
  success: EditorEvent.NodeCreated,
  error: Schema.Union([PersistenceError, Graph.NotFoundError, PkgTypes.SchemaNotFoundError]),
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
    clientId: Schema.optional(Schema.String),
  },
  success: EditorEvent.NodePositionChanged,
  error: PersistenceGraphAndNodeErrors,
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
  payload: { pluginId: Schema.String, state: Schema.Unknown },
  success: EditorEvent.EngineStateChanged,
  error: Schema.Union([PersistenceError, Editor.EngineNotRegistered, Editor.InvalidEngineState]),
}) {}

class GetIngressEndpoints extends Rpc.make("GetIngressEndpoints", {
  payload: {},
  success: Schema.Array(HttpEndpoint.Routed),
}) {}

class GetPluginClientState extends Rpc.make("GetPluginClientState", {
  payload: { pluginId: Schema.String },
  success: Schema.Unknown,
  error: Editor.EngineNotHosted,
}) {}

const ProjectEventsStream = Rpc.make("ProjectEventsStream", {
  success: Schema.Union([
    EditorEvent.GraphCreated,
    EditorEvent.GraphDeleted,
    EditorEvent.NodeCreated,
    EditorEvent.NodeDeleted,
    EditorEvent.NodeNameChanged,
    EditorEvent.NodePositionChanged,
    EditorEvent.ConnectionCreated,
    EditorEvent.ConnectionDeleted,
    EditorEvent.EngineStateChanged,
  ]),
  stream: true,
});

export const EditorRpcs = RpcGroup.make(
  CreateGraph,
  GetProject,
  DeleteGraph,
  CreateNode,
  DeleteNode,
  SetNodeName,
  SetNodePosition,
  CreateConnection,
  DeleteConnection,
  LoadPackage,
  GetPackages,
  SetEngineState,
  GetIngressEndpoints,
  GetPluginClientState,
  ProjectEventsStream,
);

export const handlerLayer = EditorRpcs.toLayer(
  Effect.gen(function* () {
    const editor = yield* Editor.Service;
    const packages = yield* Packages.Service;
    const pubsub = yield* ProjectPubSub.Service;
    return EditorRpcs.of({
      CreateGraph: (payload) => editor.graph.create(payload.graph),
      GetProject: () => editor.project.get(),
      DeleteGraph: (payload) => editor.graph.delete({ graphID: payload.graphId }),
      CreateNode: (payload) => editor.node.create({ graphID: payload.graphId, node: payload.node }),
      DeleteNode: (payload) =>
        editor.node.delete({ graphID: payload.graphId, nodeID: payload.nodeId }),
      SetNodeName: (payload) =>
        editor.node
          .update({ graphID: payload.graphId, nodeID: payload.nodeId, name: payload.name })
          .pipe(
            Effect.as({
              _tag: "NodeNameChanged" as const,
              graphId: payload.graphId,
              nodeId: payload.nodeId,
              name: payload.name,
            }),
          ),
      SetNodePosition: (payload) =>
        editor.node
          .update({
            graphID: payload.graphId,
            nodeID: payload.nodeId,
            position: { x: payload.x, y: payload.y },
            ephemeral: payload.ephemeral ?? false,
            ...(payload.clientId !== undefined ? { clientId: payload.clientId } : {}),
          })
          .pipe(
            Effect.as({
              _tag: "NodePositionChanged" as const,
              graphId: payload.graphId,
              nodeId: payload.nodeId,
              x: payload.x,
              y: payload.y,
              ...(payload.clientId !== undefined ? { clientId: payload.clientId } : {}),
            }),
          ),
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
      ProjectEventsStream: () =>
        pubsub.subscribe.pipe(Effect.map(Stream.fromSubscription), Stream.unwrap),
    });
  }),
);

export * as EditorRpc from "./EditorRpc.ts";
