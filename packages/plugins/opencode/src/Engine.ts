import {
  AbsolutePath,
  Model,
  OpenCode,
  Session,
  type OpenCodeClient,
} from "@opencode-ai/client/effect";
import { Service } from "@opencode-ai/client/effect/service";
import {
  Duration,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Result,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { randomUUID } from "node:crypto";

import {
  Catalog,
  ClientRpcs,
  ClientState,
  ConnectionConfig,
  OpenCodeConnection,
  OpenCodeEngine,
  OpenCodeModel,
  RequestFailure,
  RuntimeRpcs,
} from "./Definition.ts";

const emptyCatalog: typeof Catalog.Type = { providers: [], models: [], defaultModel: null };
type Entry = {
  readonly config: typeof ConnectionConfig.Type;
  readonly client: OpenCodeClient;
  readonly catalogLock: Semaphore.Semaphore;
  view: (typeof ClientState.Type)["connections"][number];
  watcher?: Fiber.Fiber<void>;
};

const validateAddress = (address: string) =>
  Effect.try({
    try: () => {
      const url = new URL(address.trim());
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        address.length > 2048
      )
        throw new Error();
      return url.href.replace(/\/$/, "");
    },
    catch: () =>
      new RequestFailure({
        reason: "Use an http:// or https:// address without credentials, query, or fragment.",
      }),
  });

const request = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  duration: Duration.Input = "15 seconds",
) =>
  effect.pipe(
    Effect.mapError(
      () =>
        new RequestFailure({
          reason: "OpenCode request failed. Check the connection and server status.",
        }),
    ),
    Effect.timeoutOrElse({
      duration,
      orElse: () => new RequestFailure({ reason: "OpenCode request timed out." }),
    }),
  );
const modelRef = (model: string) =>
  model.trim() === ""
    ? Effect.succeed(undefined)
    : Effect.try({
        try: () => Model.Ref.parse(model.trim()),
        catch: () => new RequestFailure({ reason: "Use provider/model for the model selection." }),
      });

export const layer = OpenCodeEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const fs = yield* FileSystem.FileSystem;
    const scope = yield* Scope.Scope;
    const lock = yield* Semaphore.make(1);
    const promptLock = yield* Semaphore.make(1);
    const entries = new Map<string, Entry>();

    const notify = mg.client.refresh.pipe(
      Effect.andThen(mg.resource.refresh(OpenCodeConnection)),
      Effect.andThen(mg.resource.refresh(OpenCodeModel)),
    );
    const fetchCatalog = Effect.fnUntraced(function* (client: OpenCodeClient, directory = "") {
      const location =
        directory.trim() === "" ? undefined : { directory: AbsolutePath.make(directory.trim()) };
      const [providers, models, defaultModel] = yield* request(
        Effect.all(
          [
            client.provider.list({ location }),
            client.model.list({ location }),
            client.model.default({ location }),
          ],
          { concurrency: "unbounded" },
        ),
      );
      const active = providers.data.filter((provider) => provider.activation !== "disabled");
      return {
        providers: active.map(({ id, name }) => ({ id, name })),
        models: models.data
          .filter(
            (model) => model.enabled && active.some((provider) => provider.id === model.providerID),
          )
          .map(({ id, name, providerID }) => ({ id, name, providerID })),
        defaultModel:
          defaultModel.data === undefined
            ? null
            : `${defaultModel.data.providerID}/${defaultModel.data.id}`,
      } satisfies typeof Catalog.Type;
    });

    const refreshCatalog = Effect.fnUntraced(
      function* (id: string, entry: Entry) {
        const result = yield* fetchCatalog(entry.client).pipe(Effect.result);
        if (entries.get(id) !== entry) return;
        const view: Entry["view"] = {
          id,
          address: entry.config.address,
          name: entry.config.name,
          discovered: id === "local",
          ...(Result.isSuccess(result)
            ? { state: "connected" as const, catalog: result.success }
            : { state: "error" as const, error: result.failure.reason, catalog: emptyCatalog }),
        };
        if (JSON.stringify(view) !== JSON.stringify(entry.view)) {
          entry.view = view;
          yield* mg.client.refresh;
          yield* mg.resource.refresh(OpenCodeModel);
        }
      },
      (effect, _id, entry) => effect.pipe(entry.catalogLock.withPermit),
    );

    const remove = Effect.fnUntraced(function* (id: string) {
      const entry = entries.get(id);
      entries.delete(id);
      if (entry?.watcher) yield* Fiber.interrupt(entry.watcher);
    });

    const reconcile = Effect.gen(function* () {
      const stored = yield* mg.storage.get;
      const found = yield* Service.discover().pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      );
      const configs = new Map(Object.entries(stored.connections).filter(([id]) => id !== "local"));
      if (found)
        configs.set("local", {
          address: found.url,
          name: "Local OpenCode",
          password: found.auth?.password ?? "",
        });
      let changed = false;
      for (const id of entries.keys()) {
        if (!configs.has(id)) {
          yield* remove(id);
          changed = true;
        }
      }
      yield* Effect.forEach(
        configs,
        Effect.fnUntraced(function* ([id, config]) {
          const existing = entries.get(id);
          if (existing && JSON.stringify(existing.config) === JSON.stringify(config)) {
            yield* refreshCatalog(id, existing);
            return;
          }
          yield* remove(id);
          const address = yield* validateAddress(config.address).pipe(Effect.result);
          if (Result.isFailure(address)) return;
          // Disable redirects so a remote server cannot forward the password elsewhere.
          const transport = http.pipe(
            HttpClient.mapRequest(
              HttpClientRequest.setHeaders(
                config.password === ""
                  ? {}
                  : {
                      authorization: `Basic ${Buffer.from(`opencode:${config.password}`, "utf8").toString("base64")}`,
                    },
              ),
            ),
            HttpClient.transformResponse((response) =>
              response.pipe(
                Effect.provideService(FetchHttpClient.RequestInit, {
                  redirect: "manual",
                  credentials: "omit",
                }),
                Effect.updateService(Headers.CurrentRedactedNames, (names) => [
                  ...names,
                  "authorization",
                ]),
              ),
            ),
          );
          const client = yield* OpenCode.make({ baseUrl: address.success }).pipe(
            Effect.provideService(HttpClient.HttpClient, transport),
          );
          const entry: Entry = {
            config,
            client,
            catalogLock: yield* Semaphore.make(1),
            view: {
              id,
              address: address.success,
              name: config.name,
              discovered: id === "local",
              state: "connecting",
              catalog: emptyCatalog,
            },
          };
          entries.set(id, entry);
          changed = true;
          yield* refreshCatalog(id, entry);
          entry.watcher = yield* client.event.subscribe().pipe(
            Stream.filter(
              (event) => event.type === "catalog.updated" || event.type === "server.connected",
            ),
            Stream.runForEach(() => refreshCatalog(id, entry)),
            Effect.ignore,
            Effect.andThen(Effect.sleep("2 seconds")),
            Effect.forever,
            Effect.forkIn(scope),
          );
        }),
        { concurrency: 4 },
      );
      if (changed) yield* notify;
    }).pipe(lock.withPermit);

    // External discovery must not delay installation of the host's HTTP routes.
    yield* reconcile.pipe(
      Effect.andThen(Effect.sleep("30 seconds")),
      Effect.forever,
      Effect.forkScoped,
    );

    const getClient = (id: string) =>
      Effect.suspend(() => {
        const entry = entries.get(id);
        return entry
          ? Effect.succeed(entry.client)
          : Effect.fail(new RequestFailure({ reason: "OpenCode connection is unavailable." }));
      });

    return OpenCodeEngine.of({
      resources: Layer.merge(
        OpenCodeConnection.toLayer(
          Effect.sync(() =>
            [...entries].map(([id, entry]) => ({ id, display: entry.config.name })),
          ),
        ),
        OpenCodeModel.toLayer(
          Effect.sync(() => {
            const values = new Map<string, { id: string; display: string }>([
              ["", { id: "", display: "Automatic (Server Default / Session Model)" }],
            ]);
            for (const entry of entries.values()) {
              for (const model of entry.view.catalog.models) {
                const id = `${model.providerID}/${model.id}`;
                const provider = entry.view.catalog.providers.find(
                  ({ id }) => id === model.providerID,
                );
                values.set(id, {
                  id,
                  display: `${model.name} (${provider?.name ?? model.providerID})`,
                });
              }
            }
            return [...values.values()];
          }),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        OpenCodeCatalog: Effect.fnUntraced(function* ({ connection, directory, sessionID }) {
          const client = yield* getClient(connection);
          const session = sessionID?.trim()
            ? yield* request(client.session.get({ sessionID: Session.ID.make(sessionID.trim()) }))
            : undefined;
          return yield* fetchCatalog(client, session?.location.directory ?? directory);
        }),
        OpenCodeSessions: Effect.fnUntraced(function* ({ connection }) {
          const client = yield* getClient(connection);
          const sessions = yield* request(client.session.list({ limit: 100 }));
          return sessions.data.map(({ id, title }) => ({ id, title: title ?? id }));
        }),
        OpenCodeCreateSession: Effect.fnUntraced(function* ({
          connection,
          directory,
          title,
          model,
        }) {
          const client = yield* getClient(connection);
          const selected = yield* modelRef(model);
          const session = yield* request(
            client.session.create({
              ...(directory.trim()
                ? { location: { directory: AbsolutePath.make(directory.trim()) } }
                : {}),
              ...(title.trim() ? { title: title.trim() } : {}),
              ...(selected ? { model: selected } : {}),
            }),
          );
          return session.id;
        }),
        OpenCodePromptSession: Effect.fnUntraced(function* ({
          connection,
          sessionID,
          text,
          model,
        }) {
          if (!sessionID.trim() || !text.trim())
            return yield* new RequestFailure({ reason: "Session ID and prompt are required." });
          const client = yield* getClient(connection);
          const selected = yield* modelRef(model);
          const id = Session.ID.make(sessionID.trim());
          // V2 switches the session model separately from admitting a prompt.
          return yield* Effect.gen(function* () {
            if (selected)
              yield* request(client.session.switchModel({ sessionID: id, model: selected }));
            const admitted = yield* request(client.session.prompt({ sessionID: id, text }));
            return admitted.id;
          }).pipe(promptLock.withPermit);
        }),
        OpenCodeWaitForSession: Effect.fnUntraced(function* ({ connection, sessionID }) {
          if (!sessionID.trim())
            return yield* new RequestFailure({ reason: "Session ID is required." });
          const client = yield* getClient(connection);
          yield* request(
            client.session.wait({ sessionID: Session.ID.make(sessionID.trim()) }),
            "30 minutes",
          );
        }),
      }),
      client: {
        state: Effect.sync(() => ({
          connections: [...entries.values()].map((entry) => entry.view),
        })),
        rpcs: ClientRpcs.toLayer({
          OpenCodeSaveConnection: Effect.fnUntraced(function* ({ id, address, name, password }) {
            const url = yield* validateAddress(address);
            if (!name.trim() || name.length > 256 || (password?.length ?? 0) > 4096)
              return yield* new RequestFailure({
                reason: "Provide a connection name and a valid password.",
              });
            yield* Effect.gen(function* () {
              const stored = yield* mg.storage.get;
              if (id !== undefined && (id === "local" || !Object.hasOwn(stored.connections, id)))
                return yield* new RequestFailure({ reason: "Manual connection not found." });
              const key = id ?? randomUUID();
              yield* mg.storage.set({
                connections: {
                  ...stored.connections,
                  [key]: {
                    address: url,
                    name: name.trim(),
                    password: password ?? stored.connections[key]?.password ?? "",
                  },
                },
              });
            }).pipe(lock.withPermit);
            yield* reconcile;
          }),
          OpenCodeRemoveConnection: Effect.fnUntraced(function* ({ id }) {
            if (id === "local")
              return yield* new RequestFailure({
                reason: "The local service is managed by OpenCode.",
              });
            yield* Effect.gen(function* () {
              yield* mg.storage.update((stored) => ({
                connections: Object.fromEntries(
                  Object.entries(stored.connections).filter(([key]) => key !== id),
                ),
              }));
              yield* remove(id);
              yield* notify;
            }).pipe(lock.withPermit);
          }),
          OpenCodeRefresh: () => reconcile,
        }),
      },
    });
  }),
);

export default layer;
