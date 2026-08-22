import {
	NodeHttpServer,
	NodeRuntime,
	NodeServices,
	NodeSocket,
} from "@effect/platform-node";
import {
	Editor,
	EditorEventProjector,
	EditorEvents,
	EditorRpc,
	EditorServer,
	Packages,
	ProjectPubSub,
} from "@macrograph/editor";
import { CloudCredentials } from "@macrograph/project-host";
import {
	DrizzleDriver,
	SqlitePersistence,
} from "@macrograph/persistence-sqlite";
import { Effect, Layer } from "effect";
import {
	FetchHttpClient,
	HttpMiddleware,
	HttpRouter,
} from "effect/unstable/http";
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { createServer } from "node:http";
import { join } from "node:path";

import Kofi from "@macrograph/plugin-kofi/Deployment/Webhook";
import OBS from "@macrograph/plugin-obs/Deployment/WebSocket";
import Twitch from "@macrograph/plugin-twitch/Deployment/WebSocket";

import { PluginHost } from "./PluginHost.ts";
import { ProjectExecution } from "./ProjectExecution.ts";
import { WebhookProxyHost } from "./WebhookProxyHost.ts";

const WsEndpoints = Layer.effectDiscard(
	Effect.gen(function* () {
		const { httpEffect } = yield* EditorServer.toDualHttpEffectWebsocket();
		return HttpRouter.add("*", "/rpc-ws", httpEffect);
	}),
);

const EditorHttpRoutes = Layer.merge(
	RpcServer.layerHttp({
		group: EditorRpc.EditorRpcs,
		path: "/rpc",
		protocol: "http",
	}),
	WsEndpoints,
);

const EditorEventsLayer = EditorEvents.layer.pipe(
	Layer.provideMerge(EditorEventProjector.layer),
	Layer.provideMerge(ProjectPubSub.defaultLayer),
);

const EditorLayer = Editor.layer.pipe(
	Layer.provideMerge(EditorEventsLayer),
	Layer.provideMerge(Packages.defaultLayer),
);

const ProjectExecutionLayer = ProjectExecution.layer.pipe(
	Layer.provideMerge(EditorLayer),
);

const HttpRoutes = Layer.mergeAll(EditorHttpRoutes, PluginHost.rpcRoute);

const MountedPlugins = Effect.all([
	PluginHost.mount(Twitch),
	PluginHost.mount(OBS),
	PluginHost.mount(Kofi),
]);

const AppLayer = Layer.effectDiscard(MountedPlugins).pipe(
	Layer.provideMerge(HttpRoutes),
	Layer.provide(EditorRpc.handlerLayer),
	Layer.provide(RpcSerialization.layerJsonRpc()),
	Layer.provide(ProjectExecutionLayer),
	Layer.provide(CloudCredentials.defaultLayer),
	Layer.provide(
		WebhookProxyHost.layer({
			deployments: [Kofi],
			publicUrl: "http://localhost:3002/webhooks",
			websocketUrl: "ws://localhost:3001/ingress",
		}),
	),
	Layer.provide(PluginHost.layer),
	Layer.provide(SqlitePersistence.layer),
	Layer.provide(
		Layer.mergeAll(
			DrizzleDriver.layerNodeSqlite(
				"./project.db",
				join(
					new URL(import.meta.url).pathname,
					"../../../../../packages/persistence-sqlite/drizzle",
				),
			),
			NodeServices.layer,
		),
	),
);

const OtlpTracingLayer = OtlpTracer.layer({
	url: "http://localhost:4318",
	resource: {
		serviceName: "server",
	},
});

const ObservabilityLayer = OtlpTracingLayer.pipe(
	Layer.provide(OtlpSerialization.layerJson),
);

const Main = HttpRouter.serve(AppLayer, {
	disableLogger: true,
	middleware: HttpMiddleware.cors(),
}).pipe(
	Layer.provide(NodeHttpServer.layerServer(createServer, { port: 3001 })),
	Layer.provide(ObservabilityLayer),
	Layer.provide(
		Layer.mergeAll(FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor),
	),
);

Layer.launch(Main).pipe(NodeRuntime.runMain);
