import { Effect, Redacted, Schema } from "effect";
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest } from "effect/unstable/http";

import {
  type AccountId,
  type ActionId,
  GitHubFailure,
  InstallationId,
  RepositoryId,
} from "./Definition.ts";

const apiOrigin = "https://api.github.com";
const maxResponseBytes = 1024 * 1024;
const pageSize = 100;
const segment = (value: string) => encodeURIComponent(value);
const stringInput = (
  inputs: Readonly<Record<string, Schema.Json>>,
  key: string,
  optional = false,
) => {
  const value = inputs[key];
  if (typeof value === "string" && (optional || value.trim().length > 0)) return value;
  if (optional && value === undefined) return "";
  throw new GitHubFailure({ reason: `${key} must be a string${optional ? "" : " and not empty"}` });
};
const intInput = (inputs: Readonly<Record<string, Schema.Json>>, key: string) => {
  const value = inputs[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new GitHubFailure({ reason: `${key} must be a positive integer` });
  return value;
};
const optionalInt = (
  inputs: Readonly<Record<string, Schema.Json>>,
  key: string,
  fallback: number,
) => {
  const value = inputs[key];
  return value === undefined ? fallback : intInput(inputs, key);
};

export interface PreparedRequest {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number>>;
  readonly body?: Schema.Json;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: Schema.Json;
}

const InstallationPage = Schema.Struct({
  installations: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      account: Schema.Struct({ id: Schema.Int, login: Schema.String, type: Schema.String }),
    }),
  ),
});

const RepositoryPage = Schema.Struct({
  repositories: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      name: Schema.String,
      full_name: Schema.String,
      owner: Schema.Struct({ login: Schema.String }),
    }),
  ),
});

export const prepare = (action: ActionId, inputs: Readonly<Record<string, Schema.Json>>) => {
  const owner = segment(stringInput(inputs, "owner"));
  const repository = segment(stringInput(inputs, "repository"));
  const repo = `/repos/${owner}/${repository}`;
  const perPage = Math.min(optionalInt(inputs, "perPage", 30), 100);
  switch (action) {
    case "get-repository":
      return { method: "GET", path: repo } satisfies PreparedRequest;
    case "list-branches":
      return {
        method: "GET",
        path: `${repo}/branches`,
        query: { per_page: perPage },
      } satisfies PreparedRequest;
    case "list-commits": {
      const ref = stringInput(inputs, "ref", true);
      return {
        method: "GET",
        path: `${repo}/commits`,
        query: { per_page: perPage, ...(ref ? { sha: ref } : {}) },
      } satisfies PreparedRequest;
    }
    case "list-releases":
      return {
        method: "GET",
        path: `${repo}/releases`,
        query: { per_page: perPage },
      } satisfies PreparedRequest;
    case "list-contributors":
      return {
        method: "GET",
        path: `${repo}/contributors`,
        query: { per_page: perPage },
      } satisfies PreparedRequest;
    case "list-issues":
      return {
        method: "GET",
        path: `${repo}/issues`,
        query: { state: stringInput(inputs, "state"), per_page: perPage },
      } satisfies PreparedRequest;
    case "get-issue":
      return {
        method: "GET",
        path: `${repo}/issues/${intInput(inputs, "number")}`,
      } satisfies PreparedRequest;
    case "create-issue":
      return {
        method: "POST",
        path: `${repo}/issues`,
        body: { title: stringInput(inputs, "title"), body: stringInput(inputs, "body", true) },
      } satisfies PreparedRequest;
    case "update-issue": {
      const title = stringInput(inputs, "title", true);
      const body = stringInput(inputs, "body", true);
      const state = stringInput(inputs, "state", true);
      return {
        method: "PATCH",
        path: `${repo}/issues/${intInput(inputs, "number")}`,
        body: {
          ...(title ? { title } : {}),
          ...(body ? { body } : {}),
          ...(state ? { state } : {}),
        },
      } satisfies PreparedRequest;
    }
    case "list-pull-requests":
      return {
        method: "GET",
        path: `${repo}/pulls`,
        query: { state: stringInput(inputs, "state"), per_page: perPage },
      } satisfies PreparedRequest;
    case "get-pull-request":
      return {
        method: "GET",
        path: `${repo}/pulls/${intInput(inputs, "number")}`,
      } satisfies PreparedRequest;
    case "create-comment":
      return {
        method: "POST",
        path: `${repo}/issues/${intInput(inputs, "number")}/comments`,
        body: { body: stringInput(inputs, "body") },
      } satisfies PreparedRequest;
  }
};

const failureMessage = (value: unknown, fallback: string) => {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
  )
    return value.message;
  return fallback;
};

export const makeApi = Effect.fnUntraced(function* (
  credential: (
    accountId: AccountId,
    refresh: boolean,
  ) => Effect.Effect<{ readonly token: Redacted.Redacted<string> }, GitHubFailure>,
) {
  const client = HttpClient.withScope(yield* HttpClient.HttpClient);
  const execute = (
    accountId: AccountId,
    request: PreparedRequest,
    refreshed = false,
  ): Effect.Effect<ApiResponse, GitHubFailure> =>
    Effect.gen(function* () {
      const auth = yield* credential(accountId, refreshed);
      const url = new URL(`${apiOrigin}${request.path}`);
      for (const [key, value] of Object.entries(request.query ?? {}))
        url.searchParams.set(key, String(value));
      let outgoing = HttpClientRequest.make(request.method)(url).pipe(
        HttpClientRequest.bearerToken(Redacted.value(auth.token)),
        HttpClientRequest.setHeaders({
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "MacroGraph",
        }),
      );
      if (request.body !== undefined)
        outgoing = yield* HttpClientRequest.bodyJson(outgoing, request.body).pipe(
          Effect.mapError(
            () => new GitHubFailure({ reason: "Could not encode the GitHub request" }),
          ),
        );
      const response = yield* client
        .execute(outgoing)
        .pipe(Effect.mapError(() => new GitHubFailure({ reason: "GitHub request failed" })));
      if (response.status === 401 && !refreshed) return yield* execute(accountId, request, true);
      const length = Number(response.headers["content-length"] ?? 0);
      if (length > maxResponseBytes)
        return yield* new GitHubFailure({
          reason: "GitHub response exceeds 1 MiB",
          status: response.status,
        });
      const text = yield* response.text.pipe(
        Effect.mapError(
          () =>
            new GitHubFailure({
              reason: "Could not read the GitHub response",
              status: response.status,
            }),
        ),
      );
      if (new TextEncoder().encode(text).byteLength > maxResponseBytes)
        return yield* new GitHubFailure({
          reason: "GitHub response exceeds 1 MiB",
          status: response.status,
        });
      const body: Schema.Json =
        text.length === 0
          ? null
          : yield* Effect.try({
              try: () => JSON.parse(text) as Schema.Json,
              catch: () =>
                new GitHubFailure({
                  reason: "GitHub returned invalid JSON",
                  status: response.status,
                }),
            });
      if (response.status < 200 || response.status >= 300)
        return yield* new GitHubFailure({
          reason: failureMessage(body, `GitHub returned HTTP ${response.status}`),
          status: response.status,
        });
      return { status: response.status, body };
    }).pipe(
      Effect.scoped,
      Effect.updateService(Headers.CurrentRedactedNames, (names) => [...names, "authorization"]),
      Effect.provideService(FetchHttpClient.RequestInit, {
        redirect: "manual",
        credentials: "omit",
      }),
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () => new GitHubFailure({ reason: "GitHub request timed out" }),
      }),
    );
  const listInstallations = Effect.fnUntraced(function* (accountId: AccountId) {
    const installations: Array<{
      readonly id: InstallationId;
      readonly accountId: string;
      readonly accountLogin: string;
      readonly accountType: string;
    }> = [];
    for (let page = 1; page <= 100; page++) {
      const response = yield* execute(accountId, {
        method: "GET",
        path: "/user/installations",
        query: { page, per_page: pageSize },
      });
      const decoded = yield* Schema.decodeUnknownEffect(InstallationPage)(response.body).pipe(
        Effect.mapError(
          () => new GitHubFailure({ reason: "GitHub returned invalid installation data" }),
        ),
      );
      installations.push(
        ...decoded.installations.map((installation) => ({
          id: InstallationId.make(String(installation.id)),
          accountId: String(installation.account.id),
          accountLogin: installation.account.login,
          accountType: installation.account.type,
        })),
      );
      if (decoded.installations.length < pageSize) return installations;
    }
    return yield* new GitHubFailure({ reason: "GitHub returned too many installations" });
  });

  const listRepositories = Effect.fnUntraced(function* (
    accountId: AccountId,
    installationId: InstallationId,
  ) {
    const repositories: Array<{
      readonly id: RepositoryId;
      readonly name: string;
      readonly fullName: string;
      readonly owner: string;
    }> = [];
    for (let page = 1; page <= 100; page++) {
      const response = yield* execute(accountId, {
        method: "GET",
        path: `/user/installations/${encodeURIComponent(installationId)}/repositories`,
        query: { page, per_page: pageSize },
      });
      const decoded = yield* Schema.decodeUnknownEffect(RepositoryPage)(response.body).pipe(
        Effect.mapError(
          () => new GitHubFailure({ reason: "GitHub returned invalid repository data" }),
        ),
      );
      repositories.push(
        ...decoded.repositories.map((repository) => ({
          id: RepositoryId.make(String(repository.id)),
          name: repository.name,
          fullName: repository.full_name,
          owner: repository.owner.login,
        })),
      );
      if (decoded.repositories.length < pageSize) return repositories;
    }
    return yield* new GitHubFailure({ reason: "GitHub returned too many repositories" });
  });

  return { execute, listInstallations, listRepositories };
});
