import type { Instance, Instances } from "@macrograph/module-opencode/Instance";
import type { connectRemote, Service } from "@macrograph/opencode-workerd";

import OpenCodeModule from "@macrograph/module-opencode";
import { OpenCodeEngine, RequestFailure } from "@macrograph/module-opencode/Definition";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";

export interface Namespace {
  readonly getByName: (name: string) => {
    readonly ensure: (config: string) => Effect.Effect<void, unknown>;
    readonly provision: (initialConfig: string) => Effect.Effect<string, unknown>;
    readonly generateText: (input: {
      readonly prompt: string;
      readonly model: string;
    }) => Effect.Effect<string, unknown>;
    readonly listModels: () => Effect.Effect<ReadonlyArray<string>, unknown>;
    readonly listCredentials: () => Effect.Effect<
      ReadonlyArray<{
        readonly id: string;
        readonly integrationID: string;
        readonly label: string;
        readonly active: boolean;
      }>,
      unknown
    >;
    readonly listOAuthMethods: () => Effect.Effect<
      ReadonlyArray<{
        readonly integrationID: string;
        readonly integrationName: string;
        readonly methodID: string;
        readonly label: string;
      }>,
      unknown
    >;
    readonly connectKey: (input: {
      readonly integrationID: string;
      readonly key: string;
    }) => Effect.Effect<void, unknown>;
    readonly removeCredential: (credentialID: string) => Effect.Effect<void, unknown>;
    readonly startOAuth: (input: {
      readonly integrationID: string;
      readonly methodID: string;
    }) => Effect.Effect<
      {
        readonly integrationID: string;
        readonly attemptID: string;
        readonly url: string;
        readonly instructions: string;
        readonly mode: "auto" | "code";
        readonly expires: number;
      },
      unknown
    >;
    readonly oauthStatus: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
    }) => Effect.Effect<
      | { readonly status: "pending" }
      | { readonly status: "complete" }
      | { readonly status: "failed"; readonly message: string }
      | { readonly status: "expired" },
      unknown
    >;
    readonly completeOAuth: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
      readonly code: string;
    }) => Effect.Effect<void, unknown>;
    readonly cancelOAuth: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
    }) => Effect.Effect<void, unknown>;
  };
}

type Stub = ReturnType<Namespace["getByName"]>;

const isNamespace = (value: unknown): value is { readonly getByName: (name: string) => unknown } =>
  typeof value === "object" &&
  value !== null &&
  "getByName" in value &&
  typeof value.getByName === "function";

/** Wraps a raw (cross-script) OpenCodeDO namespace binding in typed RPC stubs. */
export const bindNamespace = (binding: unknown): Namespace => ({
  getByName: (name) =>
    Cloudflare.Workers.makeRpcStub<Stub>(
      isNamespace(binding)
        ? Effect.sync(() => binding.getByName(name))
        : Effect.die(new Error("The OpenCodeDO namespace binding is unavailable")),
      { errors: [RequestFailure] },
    ),
});

const failure = (cause: unknown) =>
  new RequestFailure({
    reason:
      cause instanceof Error && cause.message.length > 0
        ? cause.message
        : "OpenCode request failed",
  });

const remoteInstance = (service: Service): Instance => ({
  generateText: (input) =>
    Effect.tryPromise({ try: () => service.generateText(input), catch: failure }),
  listModels: Effect.tryPromise({ try: () => service.listModels(), catch: failure }),
  listCredentials: Effect.tryPromise({ try: () => service.listCredentials(), catch: failure }),
  listOAuthMethods: Effect.tryPromise({ try: () => service.listOAuthMethods(), catch: failure }),
  connectKey: (input) =>
    Effect.tryPromise({ try: () => service.connectKey(input), catch: failure }),
  removeCredential: (credentialID) =>
    Effect.tryPromise({ try: () => service.removeCredential(credentialID), catch: failure }),
  startOAuth: (input) =>
    Effect.tryPromise({ try: () => service.startOAuth(input), catch: failure }),
  oauthStatus: (input) =>
    Effect.tryPromise({ try: () => service.oauthStatus(input), catch: failure }),
  completeOAuth: (input) =>
    Effect.tryPromise({ try: () => service.completeOAuth(input), catch: failure }),
  cancelOAuth: (input) =>
    Effect.tryPromise({ try: () => service.cancelOAuth(input), catch: failure }),
});

/** Each managed connection owns one Durable Object, shared by the editor and deployments. */
export const objectName = (projectId: string, connectionId: string) =>
  `${projectId}:${connectionId}`;

/**
 * Editor instances never apply saved config to managed connections: they provision a missing
 * instance and otherwise report the config it runs, leaving changes queued for the next deploy.
 * Production instances apply the deployed config.
 */
export type Mode = "editor" | "production";

const managedInstance = (
  stub: ReturnType<Namespace["getByName"]>,
  appliedConfig: string | undefined,
): Instance => ({
  ...(appliedConfig === undefined ? {} : { appliedConfig }),
  generateText: (input) => stub.generateText(input).pipe(Effect.mapError(failure)),
  listModels: stub.listModels().pipe(Effect.mapError(failure)),
  listCredentials: stub.listCredentials().pipe(Effect.mapError(failure)),
  listOAuthMethods: stub.listOAuthMethods().pipe(Effect.mapError(failure)),
  connectKey: (input) => stub.connectKey(input).pipe(Effect.mapError(failure)),
  removeCredential: (credentialID) =>
    stub.removeCredential(credentialID).pipe(Effect.mapError(failure)),
  startOAuth: (input) => stub.startOAuth(input).pipe(Effect.mapError(failure)),
  oauthStatus: (input) => stub.oauthStatus(input).pipe(Effect.mapError(failure)),
  completeOAuth: (input) => stub.completeOAuth(input).pipe(Effect.mapError(failure)),
  cancelOAuth: (input) => stub.cancelOAuth(input).pipe(Effect.mapError(failure)),
});

export const make = (
  projectId: Effect.Effect<string, RequestFailure>,
  namespace: Namespace,
  mode: Mode,
  connect: typeof connectRemote = (input) =>
    import("@macrograph/opencode-workerd").then(({ connectRemote }) => connectRemote(input)),
): Instances => ({
  connectionTypes: ["managed", "remote"],
  resolve: ({ id, target }) => {
    if (target.type === "remote")
      return Effect.tryPromise({
        try: () => connect({ url: target.url, password: target.password }),
        catch: failure,
      }).pipe(Effect.map(remoteInstance));
    if (target.type === "local")
      return Effect.fail(
        new RequestFailure({ reason: "Local OpenCode connections are unavailable on Cloudflare" }),
      );
    return projectId.pipe(
      Effect.map((project) => namespace.getByName(objectName(project, id))),
      Effect.flatMap((stub) =>
        mode === "production"
          ? stub
              .ensure(target.config)
              .pipe(Effect.mapError(failure), Effect.as(managedInstance(stub, undefined)))
          : stub.provision(target.config).pipe(
              Effect.mapError(failure),
              Effect.map((applied) => managedInstance(stub, applied)),
            ),
      ),
    );
  },
});

/** Applies each deployed managed connection's config to its production instance. */
export const applyDeployment = (
  projectId: string,
  engines: Readonly<Record<string, unknown>>,
  namespace: Pick<Namespace, "getByName">,
) =>
  Schema.decodeUnknownEffect(OpenCodeEngine.Storage)(
    engines[OpenCodeModule.id] ?? OpenCodeEngine.InitialStorage,
  ).pipe(
    Effect.mapError(() => new RequestFailure({ reason: "Invalid OpenCode deployment storage" })),
    Effect.flatMap((storage) =>
      Effect.forEach(
        Object.entries(storage.connections),
        ([connectionId, connection]) =>
          connection.target.type === "managed"
            ? namespace
                .getByName(objectName(projectId, connectionId))
                .ensure(connection.target.config)
                .pipe(Effect.mapError(failure))
            : Effect.void,
        { discard: true },
      ),
    ),
  );
