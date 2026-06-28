import { Connection, Graph, Node, Package as PkgTypes, Project } from "@macrograph/core";
import { PersistenceError } from "@macrograph/persistence";
import { Effect, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import * as Editor from "./Editor.ts";
import { EditorEvent } from "./EditorEvent.ts";
import { Packages } from "./Packages.ts";
import { ProjectPubSub } from "./ProjectPubSub.ts";

const ProjectAndPersistenceErrors = Schema.Union([PersistenceError, Project.NotFoundError]);

const PersistenceAndGraphErrors = Schema.Union([
  PersistenceError,
  Graph.NotFoundError,
]);

const PersistenceGraphAndNodeErrors = Schema.Union([
  PersistenceError,
  Graph.NotFoundError,
  Node.NotFoundError,
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
  error: Schema.Union([
    PersistenceError,
    Graph.NotFoundError,
    PkgTypes.SchemaNotFoundError,
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

class CreateConnection extends Rpc.make("CreateConnection", {
  payload: { graphId: Schema.String, connection: Connection.CreateInput },
  success: EditorEvent.ConnectionCreated,
  error: PersistenceAndGraphErrors,
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
  ProjectEventsStream,
);

export const handlerLayer = EditorRpcs.toLayer(
  Effect.gen(function* () {
    const editor = yield* Editor.Service;
    const packages = yield* Packages.Service;
    const pubsub = yield* ProjectPubSub.Service;
    return EditorRpcs.of({
      CreateGraph: (payload) => editor.createGraph(payload.graph),
      GetProject: () => editor.getProject(),
      DeleteGraph: (payload) => editor.deleteGraph(payload.graphId),
      CreateNode: (payload) => editor.createNode(payload.graphId, payload.node),
      DeleteNode: (payload) => editor.deleteNode(payload.graphId, payload.nodeId),
      SetNodeName: (payload) => editor.setNodeName(payload.graphId, payload.nodeId, payload.name),
      SetNodePosition: (payload) =>
        editor.setNodePosition(payload.graphId, payload.nodeId, payload.x, payload.y, { ephemeral: payload.ephemeral ?? false }),
      CreateConnection: (payload) => editor.createConnection(payload.graphId, payload.connection),
      DeleteConnection: (payload) => editor.deleteConnection(payload.graphId, payload.connectionId),
      LoadPackage: (payload) => packages.loadPackage(payload.pkg),
      ProjectEventsStream: () =>
        pubsub.subscribe.pipe(Effect.map(Stream.fromSubscription), Stream.unwrap),
    });
  }),
);

export * as EditorRpc from "./EditorRpc.ts";
