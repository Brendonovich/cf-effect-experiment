import { Catalog, Delivery, Events, Policy } from "@macrograph/gateway";
import { ApiCaller, ApiKey, type ProjectMcp } from "@macrograph/project-api";
import { and, desc, eq, gt } from "drizzle-orm";
import { type Context, Effect, Layer, Schema } from "effect";
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiError } from "effect/http-api";

import type { ConfigureRequest, GatewayDOShape, MissingDiscordToken, Status } from "./GatewayDO.ts";

import * as McpOAuthConfig from "../auth/McpOAuthConfig.ts";
import * as Database from "../database/Database.ts";
import { gatewayApiKeys, oauthAccessTokens } from "../database/DatabaseSchema.ts";
import { Gateway } from "./Gateway.ts";
import { GatewayMcp } from "./GatewayMcp.ts";

/** The user's gateway Durable Object, as the HTTP API uses it. */
export interface GatewayObject extends Omit<GatewayDOShape, "configure"> {
  readonly configure: (request: ConfigureRequest) => Effect.Effect<Status, MissingDiscordToken>;
  /** Proxies `GET /stream` to the object, which answers with server-sent events. */
  readonly stream: (request: Request) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
}

export interface Options {
  readonly objects: (userId: string) => GatewayObject;
  /** The signed-in website user, for management routes. */
  readonly authenticateSession: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<{ readonly userId: string }, unknown>;
  /** Where providers deliver webhooks for the gateway (IngressWorker's public origin). */
  readonly ingressOrigin: (request: HttpServerRequest.HttpServerRequest) => string;
}

export const apiPrefix = "/api/gateway/v1";
export const managePrefix = "/api/gateway/manage";
export const keyPrefix = "mgw_";

const maxApprovalWaitSeconds = 25;

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-store" } });
const error = (status: number, message: string) => json({ error: message }, status);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = (request: HttpServerRequest.HttpServerRequest) =>
  request.json.pipe(
    Effect.map((body) => (isRecord(body) ? body : undefined)),
    Effect.catch(() => Effect.succeed(undefined)),
  );

const integer = (value: string | null | undefined, fallback: number, max: number) => {
  const parsed = value === null || value === undefined ? Number.NaN : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const ApprovalBody = Schema.Struct({
  account: Schema.optionalKey(Schema.String),
  arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
});

const SubscriptionsBody = Schema.Struct({
  twitch: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  github: Events.Subscriptions.fields.github,
  discord: Schema.NullOr(
    Schema.Struct({
      token: Schema.NullOr(Schema.String),
      intents: Schema.Array(Schema.String),
    }),
  ),
});

const WebhookBody = Schema.Struct({
  url: Schema.String,
  events: Schema.Array(Schema.String),
});

/** A gateway API key, or an MCP OAuth token issued for the gateway. */
export const authenticate =
  (database: Context.Service.Shape<typeof Database.Service>) =>
  (
    request: HttpServerRequest.HttpServerRequest,
  ): Effect.Effect<ProjectMcp.Principal, HttpApiError.Unauthorized> =>
    Effect.gen(function* () {
      const token = ApiKey.fromAuthorization(request.headers.authorization);
      if (token === undefined) return yield* new HttpApiError.Unauthorized();
      const tokenHash = yield* ApiKey.hash(token);
      if (token.startsWith(keyPrefix)) {
        const rows = yield* database
          .update(gatewayApiKeys)
          .set({ lastUsedAt: new Date().toISOString() })
          .where(eq(gatewayApiKeys.keyHash, tokenHash))
          .returning({
            id: gatewayApiKeys.id,
            name: gatewayApiKeys.name,
            userId: gatewayApiKeys.userId,
          })
          .pipe(Effect.orDie);
        const key = rows[0];
        if (key === undefined) return yield* new HttpApiError.Unauthorized();
        return {
          user: { id: key.userId },
          caller: ApiCaller.forApiKey({ id: key.id, name: key.name }, null),
        };
      }
      const rows = yield* database
        .select({ userId: oauthAccessTokens.userId })
        .from(oauthAccessTokens)
        .where(
          and(
            eq(oauthAccessTokens.tokenHash, tokenHash),
            eq(oauthAccessTokens.resource, McpOAuthConfig.resourceUrl(McpOAuthConfig.gateway)),
            eq(oauthAccessTokens.scope, McpOAuthConfig.scope),
            gt(oauthAccessTokens.expiresAt, new Date().toISOString()),
          ),
        )
        .limit(1)
        .pipe(Effect.orDie);
      const grant = rows[0];
      if (grant === undefined) return yield* new HttpApiError.Unauthorized();
      return { user: { id: grant.userId }, caller: ApiCaller.anonymous };
    });

/** The gateway's HTTP API and the website's management routes, served by CloudWorker. */
export const layer = (options: Options) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const gateway = yield* Gateway.Service;
      const database = yield* Database.Service;

      const approvalView = (approval: Gateway.Approval) => ({
        ...approval,
        approveUrl: GatewayMcp.approvalUrl(approval.id),
      });

      // ---- Authentication ----

      const authenticateBearer = authenticate(database);

      type Handler<R> = (
        userId: string,
        request: HttpServerRequest.HttpServerRequest,
        caller: ApiCaller.Caller | null,
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>;

      const failure = (cause: unknown) =>
        Effect.logError("Gateway request failed", cause).pipe(
          Effect.as(error(500, "Something went wrong")),
        );

      /** Routes for agents and scripts, authenticated by bearer token. */
      const api = <R>(method: "GET" | "POST", path: `/${string}`, handler: Handler<R>) =>
        router.add(method, `${apiPrefix}${path}`, (request) =>
          authenticateBearer(request).pipe(
            Effect.flatMap(({ user, caller }) =>
              gateway.allows(user.id)
                ? handler(user.id, request, caller)
                : Effect.succeed(error(403, "The gateway isn't enabled for this account.")),
            ),
            Effect.catchTag("Unauthorized", () =>
              Effect.succeed(
                HttpServerResponse.empty({
                  status: 401,
                  headers: { "www-authenticate": 'Bearer realm="macrograph-gateway"' },
                }),
              ),
            ),
            Effect.catchCause(failure),
          ),
        );

      /**
       * Routes for the website, authenticated by its session cookie only, so an agent's token can
       * never change policies or approve its own calls.
       */
      const manage = <R>(
        method: "GET" | "POST" | "PUT" | "DELETE",
        path: `/${string}`,
        handler: Handler<R>,
      ) =>
        router.add(method, `${managePrefix}${path}`, (request) =>
          options.authenticateSession(request).pipe(
            Effect.matchEffect({
              onFailure: () => Effect.succeed(HttpServerResponse.empty({ status: 401 })),
              onSuccess: ({ userId }) =>
                path !== "/access" && !gateway.allows(userId)
                  ? Effect.succeed(HttpServerResponse.empty({ status: 404 }))
                  : handler(userId, request, null),
            }),
            Effect.catchCause(failure),
          ),
        );

      // ---- Tools and approvals ----

      const listTools = (userId: string) =>
        Effect.gen(function* () {
          const accounts = yield* gateway.accounts(userId);
          const states = yield* gateway.tools(userId);
          return states.flatMap(({ tool, policy }) => {
            const connected = accounts.filter((account) => account.provider === tool.provider);
            if (connected.length === 0) return [];
            const descriptor = GatewayMcp.descriptor(tool, connected, policy);
            return [
              {
                name: tool.name,
                provider: tool.provider,
                title: tool.title,
                description: descriptor.description,
                method: tool.method,
                readOnly: tool.readOnly,
                policy,
                inputSchema: descriptor.inputSchema,
              },
            ];
          });
        });

      const callerLabel = (caller: ApiCaller.Caller | null) =>
        caller?.mcpClient?.name ??
        (caller?.apiKey === null || caller?.apiKey === undefined
          ? null
          : `API key "${caller.apiKey.name}"`);

      yield* api("GET", "/accounts", (userId) =>
        gateway.accounts(userId).pipe(Effect.map((accounts) => json({ accounts }))),
      );

      yield* api("GET", "/tools", (userId) =>
        listTools(userId).pipe(Effect.map((tools) => json({ tools }))),
      );

      yield* api("POST", "/tools/:name", (userId, request, caller) =>
        Effect.gen(function* () {
          const { name } = yield* HttpRouter.params;
          const tool = Catalog.tool(name ?? "");
          if (tool === undefined) return error(404, `Unknown tool: ${name}`);
          const body = yield* readJson(request);
          if (body !== undefined && !Schema.is(ApprovalBody)(body))
            return error(400, "Expected { account?: string, arguments?: object }");
          const waitSeconds = integer(
            new URL(request.url, "http://gateway").searchParams.get("wait"),
            0,
            maxApprovalWaitSeconds,
          );
          const outcome = yield* gateway.call({
            userId,
            tool,
            account: body?.account,
            arguments: body?.arguments ?? {},
            caller: callerLabel(caller),
          });
          switch (outcome._tag) {
            case "Completed":
              return json({ status: outcome.response.status, body: outcome.response.body });
            case "Failed":
              return error(400, outcome.message);
            case "Approval": {
              const approval =
                waitSeconds === 0
                  ? outcome.approval
                  : ((yield* gateway.await(userId, outcome.approval.id, waitSeconds * 1000)) ??
                    outcome.approval);
              return approval.status === "succeeded" && approval.result !== null
                ? json({ status: approval.result.status, body: approval.result.body })
                : json({ approval: approvalView(approval) }, 202);
            }
          }
        }),
      );

      yield* api("GET", "/approvals/:id", (userId, request) =>
        Effect.gen(function* () {
          const { id } = yield* HttpRouter.params;
          const waitSeconds = integer(
            new URL(request.url, "http://gateway").searchParams.get("wait"),
            0,
            maxApprovalWaitSeconds,
          );
          const approval =
            waitSeconds === 0
              ? yield* gateway.approval(userId, id ?? "")
              : yield* gateway.await(userId, id ?? "", waitSeconds * 1000);
          return approval === undefined
            ? error(404, "No approval with that ID")
            : json({ approval: approvalView(approval) });
        }),
      );

      // ---- Events ----

      const history = (userId: string, request: HttpServerRequest.HttpServerRequest) => {
        const params = new URL(request.url, "http://gateway").searchParams;
        const after = params.get("after");
        return options
          .objects(userId)
          .events({
            ...(after === null ? {} : { after: integer(after, 0, Number.MAX_SAFE_INTEGER) }),
            limit: integer(params.get("limit"), 100, 500),
          })
          .pipe(Effect.map((events) => json({ events })));
      };

      const stream = (userId: string, request: HttpServerRequest.HttpServerRequest) => {
        const params = new URL(request.url, "http://gateway").searchParams;
        const target = new URL("http://gateway/stream");
        const after = params.get("after");
        if (after !== null) target.searchParams.set("after", after);
        const lastEventId = request.headers["last-event-id"];
        return options.objects(userId).stream(
          new Request(target, {
            headers: lastEventId === undefined ? {} : { "last-event-id": lastEventId },
          }),
        );
      };

      yield* api("GET", "/events", (userId, request) => history(userId, request));
      yield* api("GET", "/events/stream", (userId, request) => stream(userId, request));

      // ---- Management: access, tools, approvals ----

      yield* manage("GET", "/access", (userId) =>
        Effect.succeed(json({ enabled: gateway.allows(userId) })),
      );

      yield* manage("GET", "/tools", (userId) =>
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

      yield* manage("PUT", "/tools/:tool", (userId, request) =>
        Effect.gen(function* () {
          const { tool } = yield* HttpRouter.params;
          const body = yield* readJson(request);
          if (body === undefined || !Schema.is(Policy)(body.policy))
            return HttpServerResponse.empty({ status: 400 });
          const updated = yield* gateway.setPolicy(userId, tool ?? "", body.policy);
          return HttpServerResponse.empty({ status: updated ? 204 : 404 });
        }),
      );

      yield* manage("GET", "/approvals", (userId) =>
        gateway.approvals(userId).pipe(Effect.map((approvals) => json(approvals))),
      );

      for (const decision of ["approve", "deny"] as const)
        yield* manage("POST", `/approvals/:id/${decision}`, (userId) =>
          Effect.gen(function* () {
            const { id } = yield* HttpRouter.params;
            const decided = yield* gateway.decide(userId, id ?? "", decision);
            return decided === undefined ? json(null, 409) : json(decided);
          }),
        );

      // ---- Management: API keys ----

      yield* manage("GET", "/keys", (userId) =>
        database
          .select({
            id: gatewayApiKeys.id,
            name: gatewayApiKeys.name,
            createdAt: gatewayApiKeys.createdAt,
            lastUsedAt: gatewayApiKeys.lastUsedAt,
          })
          .from(gatewayApiKeys)
          .where(eq(gatewayApiKeys.userId, userId))
          .orderBy(desc(gatewayApiKeys.createdAt))
          .pipe(
            Effect.orDie,
            Effect.map((keys) => json({ keys })),
          ),
      );

      yield* manage("POST", "/keys", (userId, request) =>
        Effect.gen(function* () {
          const body = yield* readJson(request);
          const name = typeof body?.name === "string" ? body.name.trim() : "";
          if (name === "" || name.length > 100) return error(400, "Give the key a name");
          const key = `${keyPrefix}${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;
          const created = {
            id: crypto.randomUUID(),
            name,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
          };
          yield* database
            .insert(gatewayApiKeys)
            .values({ ...created, userId, keyHash: yield* ApiKey.hash(key) })
            .pipe(Effect.orDie);
          return json({ ...created, key }, 201);
        }),
      );

      yield* manage("DELETE", "/keys/:id", (userId) =>
        Effect.gen(function* () {
          const { id } = yield* HttpRouter.params;
          const removed = yield* database
            .delete(gatewayApiKeys)
            .where(and(eq(gatewayApiKeys.id, id ?? ""), eq(gatewayApiKeys.userId, userId)))
            .returning({ id: gatewayApiKeys.id })
            .pipe(Effect.orDie);
          return HttpServerResponse.empty({ status: removed.length > 0 ? 204 : 404 });
        }),
      );

      // ---- Management: event subscriptions ----

      /** The user's subscriptions with what they can choose from, as the website edits them. */
      const subscriptionsView = (userId: string, status: Status) =>
        Effect.gen(function* () {
          const accounts = yield* gateway.accounts(userId);
          return json({
            ...status,
            options: {
              twitch: {
                accounts: accounts.filter((account) => account.provider === "twitch"),
                events: Events.twitchEventTypes,
              },
              github: {
                accounts: accounts.filter((account) => account.provider === "github"),
                events: Events.githubEventTypes,
              },
              discord: { intents: Events.discordIntents },
            },
          });
        });

      yield* manage("GET", "/subscriptions", (userId) =>
        options
          .objects(userId)
          .status()
          .pipe(Effect.flatMap((status) => subscriptionsView(userId, status))),
      );

      yield* manage("PUT", "/subscriptions", (userId, request) =>
        Effect.gen(function* () {
          const body = yield* readJson(request);
          if (!Schema.is(SubscriptionsBody)(body)) return error(400, "Invalid subscriptions");
          const accounts = yield* gateway.accounts(userId);
          const connected = (provider: string, id: string) =>
            accounts.some((account) => account.provider === provider && account.id === id);
          for (const [account, events] of Object.entries(body.twitch)) {
            if (!connected("twitch", account))
              return error(400, `Twitch account ${account} isn't connected`);
            if (events.some((event) => !Events.twitchEventTypes.includes(event)))
              return error(400, "Unknown Twitch event type");
          }
          for (const repository of body.github) {
            if (!connected("github", repository.account))
              return error(400, `GitHub account ${repository.account} isn't connected`);
            if (repository.events.some((event) => !Events.githubEventTypes.includes(event)))
              return error(400, "Unknown GitHub event");
          }
          if (
            body.discord !== null &&
            body.discord.intents.some(
              (intent) => !Events.discordIntents.some((candidate) => candidate.id === intent),
            )
          )
            return error(400, "Unknown Discord intent");
          return yield* options
            .objects(userId)
            .configure({
              userId,
              publicOrigin: options.ingressOrigin(request),
              subscriptions: body,
            })
            .pipe(
              Effect.flatMap((status) => subscriptionsView(userId, status)),
              Effect.catchTag("GatewayMissingDiscordToken", () =>
                Effect.succeed(error(400, "Enter the Discord bot's token")),
              ),
            );
        }),
      );

      yield* manage("GET", "/github/repositories", (userId) =>
        Effect.gen(function* () {
          const accounts = (yield* gateway.accounts(userId)).filter(
            (account) => account.provider === "github",
          );
          const repositories = yield* Effect.forEach(accounts, (account) =>
            Effect.gen(function* () {
              const installations = yield* gateway.request(userId, "github", account.id, {
                method: "GET",
                path: "/user/installations",
                query: { per_page: 100 },
              });
              if ("error" in installations || installations.response.status !== 200) return [];
              const body = installations.response.body;
              const list =
                isRecord(body) && Array.isArray(body.installations) ? body.installations : [];
              return (yield* Effect.forEach(list, (installation) =>
                Effect.gen(function* () {
                  if (!isRecord(installation)) return [];
                  const installationId = String(installation.id);
                  const page = yield* gateway.request(userId, "github", account.id, {
                    method: "GET",
                    path: `/user/installations/${encodeURIComponent(installationId)}/repositories`,
                    query: { per_page: 100 },
                  });
                  if ("error" in page || page.response.status !== 200) return [];
                  const repos =
                    isRecord(page.response.body) && Array.isArray(page.response.body.repositories)
                      ? page.response.body.repositories
                      : [];
                  return repos.flatMap((repository) =>
                    isRecord(repository) && isRecord(repository.owner)
                      ? [
                          {
                            account: account.id,
                            installationId,
                            repositoryId: String(repository.id),
                            owner: String(repository.owner.login),
                            repository: String(repository.name),
                          },
                        ]
                      : [],
                  );
                }),
              )).flat();
            }),
          );
          return json({ repositories: repositories.flat() });
        }),
      );

      // ---- Management: events and webhooks ----

      yield* manage("GET", "/events", (userId, request) => history(userId, request));
      yield* manage("GET", "/events/stream", (userId, request) => stream(userId, request));

      yield* manage("GET", "/webhooks", (userId) =>
        options
          .objects(userId)
          .webhooks()
          .pipe(Effect.map((webhooks) => json({ webhooks }))),
      );

      yield* manage("POST", "/webhooks", (userId, request) =>
        Effect.gen(function* () {
          const body = yield* readJson(request);
          if (!Schema.is(WebhookBody)(body)) return error(400, "Expected { url, events }");
          if (!Delivery.validTarget(body.url)) return error(400, "Use a public https:// URL");
          if (body.events.length > 50 || body.events.some((event) => event.length > 200))
            return error(400, "Too many event filters");
          const webhooks = yield* options.objects(userId).webhooks();
          if (webhooks.length >= 20) return error(400, "You can have up to 20 webhooks");
          return json(yield* options.objects(userId).addWebhook(body), 201);
        }),
      );

      yield* manage("DELETE", "/webhooks/:id", (userId) =>
        Effect.gen(function* () {
          const { id } = yield* HttpRouter.params;
          const removed = yield* options.objects(userId).removeWebhook(id ?? "");
          return HttpServerResponse.empty({ status: removed ? 204 : 404 });
        }),
      );

      yield* manage("GET", "/webhooks/:id/deliveries", (userId) =>
        Effect.gen(function* () {
          const { id } = yield* HttpRouter.params;
          return json({ deliveries: yield* options.objects(userId).deliveries(id) });
        }),
      );
    }),
  );

export * as GatewayHttp from "./GatewayHttp.ts";
