import { Catalog, Policy } from "@macrograph/gateway";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http";

import { requestOrigin } from "../api/HttpOrigin.ts";
import { Gateway } from "../gateway/Gateway.ts";
import * as Session from "./Session.ts";

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const sameOrigin = (request: HttpServerRequest.HttpServerRequest) => {
  const origin = request.headers.origin;
  return origin !== undefined && URL.canParse(origin)
    ? new URL(origin).origin === requestOrigin(request)
    : false;
};

const isPolicy = Schema.is(Policy);

/**
 * The account's gateway settings: which tools agents may call and the calls waiting for approval.
 * Only the website's own cookie session gets in, so agents holding a gateway token or API key can
 * never change their own policy or approve their own calls.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const gateway = yield* Gateway.Service;
    const sessions = yield* Session.make;

    const route = <R>(
      method: "GET" | "PUT" | "POST",
      path: `/api/website/gateway${string}`,
      handler: (
        userId: string,
        request: HttpServerRequest.HttpServerRequest,
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>,
    ) =>
      router.add(method, path, (request) =>
        Effect.gen(function* () {
          if (method !== "GET" && !sameOrigin(request))
            return HttpServerResponse.empty({ status: 403 });
          const sessionId = request.cookies[Session.cookieName];
          const validated =
            sessionId === undefined ? undefined : yield* sessions.validate(sessionId);
          if (validated === undefined) return HttpServerResponse.empty({ status: 401 });
          if (path !== "/api/website/gateway/access" && !gateway.allows(validated.user.id))
            return HttpServerResponse.empty({ status: 404 });
          return yield* handler(validated.user.id, request);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Gateway request failed", cause).pipe(
              Effect.as(HttpServerResponse.empty({ status: 500 })),
            ),
          ),
        ),
      );

    yield* route("GET", "/api/website/gateway/access", (userId) =>
      Effect.succeed(json({ enabled: gateway.allows(userId) })),
    );

    yield* route("GET", "/api/website/gateway/tools", (userId) =>
      Effect.gen(function* () {
        const accounts = yield* gateway.accounts(userId);
        const tools = yield* gateway.tools(userId);
        return json({
          providers: Catalog.providers.map((provider) => ({
            id: provider.id,
            displayName: provider.displayName,
            accounts: accounts
              .filter((account) => account.provider === provider.id)
              .map(({ id, displayName }) => ({ id, displayName })),
            tools: tools
              .filter(({ tool }) => tool.provider === provider.id)
              .map(({ tool, policy, defaultPolicy }) => ({
                name: tool.name,
                title: tool.title,
                description: tool.description,
                method: tool.method,
                readOnly: tool.readOnly,
                policy,
                defaultPolicy,
              })),
          })),
        });
      }),
    );

    yield* route("PUT", "/api/website/gateway/tools/:tool", (userId, request) =>
      Effect.gen(function* () {
        const { tool } = yield* HttpRouter.params;
        const body = yield* request.json.pipe(Effect.catch(() => Effect.succeed(undefined)));
        const policy =
          typeof body === "object" && body !== null && "policy" in body ? body.policy : undefined;
        if (!isPolicy(policy)) return HttpServerResponse.empty({ status: 400 });
        const updated = yield* gateway.setPolicy(userId, tool ?? "", policy);
        return HttpServerResponse.empty({ status: updated ? 204 : 404 });
      }),
    );

    yield* route("GET", "/api/website/gateway/approvals", (userId) =>
      gateway.approvals(userId).pipe(Effect.map((approvals) => json(approvals))),
    );

    for (const decision of ["approve", "deny"] as const)
      yield* route("POST", `/api/website/gateway/approvals/:id/${decision}`, (userId) =>
        Effect.gen(function* () {
          const { id } = yield* HttpRouter.params;
          const decided = yield* gateway.decide(userId, id ?? "", decision);
          return decided === undefined ? json(null, 409) : json(decided);
        }),
      );
  }),
);

export * as GatewayRoutes from "./GatewayRoutes.ts";
