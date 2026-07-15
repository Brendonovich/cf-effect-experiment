import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { Context, Layer, Option } from "effect";
import * as Effect from "effect/Effect";
import { HttpMiddleware, HttpServerRequest } from "effect/unstable/http";

import { ObservabilityLayer } from "./Observability.ts";
import ProjectEditor from "./ProjectEditor.ts";

export class AssetsDir extends Context.Service<AssetsDir, Alchemy.Output<string> | undefined>()(
  "AssetsDir",
) {}

export class MainWorker extends Cloudflare.Worker<MainWorker, {}>()("MainWorker") {}

export default Layer.unwrap(
  Effect.gen(function* () {
    const assetsDir = Option.getOrUndefined(
      (yield* Effect.serviceOption(AssetsDir)) ?? Option.none(),
    );
    return MainWorker.make(
      {
        main: import.meta.url,
        assets: assetsDir
          ? Output.map(assetsDir, (directory) => ({
              directory,
              htmlHandling: "auto-trailing-slash",
            }))
          : undefined,
        dev: { port: 1337, strictPort: true },
      },
      Effect.gen(function* () {
        const projectEditors = yield* ProjectEditor;

        return {
          fetch: Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;

            const projectEditor = projectEditors.getByName("test");
            const response = projectEditor.fetch(request);

            if (request.headers.upgrade?.toLowerCase() === "websocket") {
              return yield* response;
            }

            return yield* response.pipe(HttpMiddleware.cors());
          }).pipe(Effect.provide(ObservabilityLayer)),
        };
      }).pipe(Effect.provide(ObservabilityLayer)),
    );
  }),
);
