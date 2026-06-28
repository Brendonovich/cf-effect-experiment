import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Project, defaultPackage } from "@macrograph/core";
import { Editor, EditorRpc, EditorServer, Packages, ProjectPubSub } from "@macrograph/editor";
import { Persistence } from "@macrograph/persistence";
import { DrizzleDriver, SqlitePersistence } from "@macrograph/persistence-sqlite";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpMiddleware, HttpRouter } from "effect/unstable/http";
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { createServer } from "node:http";
import { join } from "node:path";

const WsEndpoints = Layer.effectDiscard(
  Effect.gen(function* () {
    const { httpEffect } = yield* EditorServer.toDualHttpEffectWebsocket();
    const router = yield* HttpRouter.HttpRouter;
    yield* router.add("*", "/rpc-ws", httpEffect);
  }),
);

const HttpRoutes = Layer.merge(
  RpcServer.layerHttp({ group: EditorRpc.EditorRpcs, path: "/rpc", protocol: "http" }),
  WsEndpoints,
);

const PackagesLayer = Layer.effect(
  Packages.Service,
  Effect.gen(function* () {
    const packages = yield* Packages.Service;
    yield* packages.loadPackage(defaultPackage);
    return packages;
  }),
).pipe(Layer.provide(Packages.defaultLayer));

const EditorLayer = Editor.defaultLayer.pipe(
  Layer.provideMerge(PackagesLayer),
);

const SeedLayer = Layer.effectDiscard(
  Effect.flatMap(Persistence.Service, (persistence) =>
    persistence.saveProject(
      new Project.Model({
        name: "test",
        graphs: {},
      }),
    ),
  ),
);

const AppLayer = HttpRoutes.pipe(
  Layer.provide(EditorRpc.handlerLayer),
  Layer.provide(
    Layer.mergeAll(
      SeedLayer,
      RpcSerialization.layerJsonRpc(),
      EditorLayer,
      ProjectPubSub.defaultLayer,
    ),
  ),
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
  Layer.provide(FetchHttpClient.layer),
);

const Main = HttpRouter.serve(AppLayer, {
  disableLogger: true,
  middleware: HttpMiddleware.cors(),
}).pipe(
  Layer.provide(NodeHttpServer.layerServer(createServer, { port: 3001 })),
  Layer.provide(ObservabilityLayer),
);

Layer.launch(Main).pipe(NodeRuntime.runMain);
