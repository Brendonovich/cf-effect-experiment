import { ModuleRegistry } from "@macrograph/module-host/core";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect, Option, Schema, type Scope } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import type { TeamRole } from "../database/DatabaseSchema.ts";

import { canMutateProject } from "../team/TeamAccess.ts";

/** `/module/<namespace>/<publisher>/<name>/rpc[/<rest>]`, the path the worker forwards. */
export const parse = (url: string) => {
  const path = new URL(url, "http://project-editor.local").pathname;
  const segments = path.split("/");
  // ["", "module", namespace, publisher, name, "rpc", ...rest]
  if (segments[1] !== "module" || segments[5] !== "rpc") return Option.none();
  return Option.map(
    ModuleId.parse(segments.slice(2, 5).map(decodeURIComponent).join("/")),
    (id) => ({
      id,
      rest: segments.slice(6).join("/"),
    }),
  );
};

export const isModulePath = (url: string) =>
  new URL(url, "http://project-editor.local").pathname.startsWith("/module/");

const isRole = (value: string | undefined): value is TeamRole =>
  value === "owner" || value === "member" || value === "viewer";

const noStore = { "cache-control": "no-store" };

/**
 * Serves a module's RPCs inside the project's editor. The worker authenticates the caller and
 * sets the identity headers; module RPCs change project state, so they need edit access.
 */
export const serve = (
  registry: ModuleRegistry.Service["Service"],
  options: { readonly projectId: string | undefined },
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | Scope.Scope
> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const role = request.headers["x-macrograph-role"];
    const projectId = request.headers["x-macrograph-project-id"];
    if (
      !isRole(role) ||
      request.headers["x-macrograph-user-id"] === undefined ||
      projectId === undefined ||
      projectId !== options.projectId
    )
      return HttpServerResponse.empty({ status: 401, headers: noStore });
    if (!canMutateProject(role)) return HttpServerResponse.empty({ status: 403, headers: noStore });
    const parsed = parse(request.url);
    if (Option.isNone(parsed))
      return HttpServerResponse.text("Module not found", { status: 404, headers: noStore });
    const { id, rest } = parsed.value;
    return yield* registry.rpcHandler(id).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.succeed(
              HttpServerResponse.text("Module has no RPCs", { status: 404, headers: noStore }),
            ),
          // Forward with the module prefix stripped.
          onSome: (handler) =>
            handler.pipe(
              Effect.provideService(
                HttpServerRequest.HttpServerRequest,
                request.modify({ url: `/${rest}` }),
              ),
            ),
        }),
      ),
      Effect.catchTags({
        ModuleNotFound: () =>
          Effect.succeed(
            HttpServerResponse.text("Module not found", { status: 404, headers: noStore }),
          ),
        ModuleNotLoaded: (error) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              Schema.encodeSync(ModuleAdminRpc.ModuleNotLoaded)(error),
              {
                status: 503,
                headers: noStore,
              },
            ),
          ),
      }),
    );
  });

export * as ModuleRpcRoutes from "./ModuleRpcRoutes.ts";
