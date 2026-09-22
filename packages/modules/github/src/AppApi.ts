import { Clock, Context, Effect, Redacted, Schema } from "effect";
import { Headers, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { GitHubFailure, type InstallationId } from "./Definition.ts";

const apiOrigin = "https://api.github.com";

export class AppCredentials extends Context.Service<
  AppCredentials,
  { readonly appId: string; readonly privateKey: Redacted.Redacted<string> }
>()("@macrograph/module-github/AppCredentials") {}

export interface RepositoryHook {
  readonly id: number;
  readonly active: boolean;
  readonly events: ReadonlyArray<string>;
  readonly url: string;
}

const TokenResponse = Schema.Struct({ token: Schema.String, expires_at: Schema.String });
const HooksResponse = Schema.Array(
  Schema.Struct({
    id: Schema.Int,
    active: Schema.Boolean,
    events: Schema.Array(Schema.String),
    config: Schema.Struct({ url: Schema.String }),
  }),
);

const base64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const concatBytes = (...values: ReadonlyArray<Uint8Array>) => {
  const output = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
};

const derLength = (length: number) => {
  if (length < 128) return Uint8Array.of(length);
  const bytes: Array<number> = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
};

const der = (tag: number, value: Uint8Array) =>
  concatBytes(Uint8Array.of(tag), derLength(value.length), value);

const pkcs8FromPkcs1 = (pkcs1: Uint8Array) => {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithm = Uint8Array.of(
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
    0x05,
    0x00,
  );
  return der(0x30, concatBytes(version, rsaAlgorithm, der(0x04, pkcs1)));
};

const privateKeyBytes = (privateKey: Redacted.Redacted<string>) => {
  const pem = Redacted.value(privateKey).replaceAll("\\n", "\n");
  const pkcs1 = pem.includes("-----BEGIN RSA PRIVATE KEY-----");
  const encoded = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace("-----BEGIN RSA PRIVATE KEY-----", "")
    .replace("-----END RSA PRIVATE KEY-----", "")
    .replaceAll(/\s/g, "");
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return pkcs1 ? pkcs8FromPkcs1(bytes) : bytes;
};

const makeAppJwt = Effect.fnUntraced(function* (credentials: {
  readonly appId: string;
  readonly privateKey: Redacted.Redacted<string>;
}) {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1_000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: credentials.appId }),
  );
  const unsigned = `${header}.${payload}`;
  const key = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "pkcs8",
        privateKeyBytes(credentials.privateKey),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    catch: () => new GitHubFailure({ reason: "Could not read the GitHub App private key" }),
  });
  const signature = yield* Effect.tryPromise({
    try: () => crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
    catch: () => new GitHubFailure({ reason: "Could not sign the GitHub App token" }),
  });
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
});

export const makeAppApi = Effect.fnUntraced(function* () {
  const credentials = yield* AppCredentials;
  const client = yield* HttpClient.HttpClient;

  const request = Effect.fnUntraced(
    function* (
      token: string,
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: string,
      body?: Schema.Json,
    ) {
      let outgoing = HttpClientRequest.make(method)(`${apiOrigin}${path}`).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeaders({
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "MacroGraph",
        }),
      );
      if (body !== undefined)
        outgoing = yield* HttpClientRequest.bodyJson(outgoing, body).pipe(
          Effect.mapError(
            () => new GitHubFailure({ reason: "Could not encode the GitHub request" }),
          ),
        );
      const response = yield* client
        .execute(outgoing)
        .pipe(Effect.mapError(() => new GitHubFailure({ reason: "GitHub request failed" })));
      const text = yield* response.text.pipe(
        Effect.mapError(
          () =>
            new GitHubFailure({
              reason: "Could not read the GitHub response",
              status: response.status,
            }),
        ),
      );
      const decoded: unknown =
        text === ""
          ? null
          : yield* Effect.try({
              try: () => JSON.parse(text),
              catch: () =>
                new GitHubFailure({
                  reason: "GitHub returned invalid JSON",
                  status: response.status,
                }),
            });
      if (response.status < 200 || response.status >= 300) {
        const reason =
          typeof decoded === "object" &&
          decoded !== null &&
          "message" in decoded &&
          typeof decoded.message === "string"
            ? decoded.message
            : `GitHub returned HTTP ${response.status}`;
        return yield* new GitHubFailure({ reason, status: response.status });
      }
      return decoded;
    },
    Effect.updateService(Headers.CurrentRedactedNames, (names) => [...names, "authorization"]),
  );

  const installationToken = Effect.fnUntraced(function* (installationId: InstallationId) {
    const jwt = yield* makeAppJwt(credentials);
    const body = yield* request(
      jwt,
      "POST",
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    );
    const decoded = yield* Schema.decodeUnknownEffect(TokenResponse)(body).pipe(
      Effect.mapError(
        () => new GitHubFailure({ reason: "GitHub returned an invalid installation token" }),
      ),
    );
    return Redacted.make(decoded.token);
  });

  const listHooks = Effect.fnUntraced(function* (
    token: Redacted.Redacted<string>,
    owner: string,
    repository: string,
  ) {
    const hooks: Array<RepositoryHook> = [];
    for (let page = 1; page <= 100; page++) {
      const body = yield* request(
        Redacted.value(token),
        "GET",
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/hooks?per_page=100&page=${page}`,
      );
      const decoded = yield* Schema.decodeUnknownEffect(HooksResponse)(body).pipe(
        Effect.mapError(
          () => new GitHubFailure({ reason: "GitHub returned invalid webhook data" }),
        ),
      );
      hooks.push(
        ...decoded.map((hook) => ({
          id: hook.id,
          active: hook.active,
          events: hook.events,
          url: hook.config.url,
        })),
      );
      if (decoded.length < 100) return hooks;
    }
    return yield* new GitHubFailure({ reason: "GitHub returned too many repository webhooks" });
  });

  const saveHook = (
    token: Redacted.Redacted<string>,
    owner: string,
    repository: string,
    endpointUrl: string,
    secret: Redacted.Redacted<string>,
    events: ReadonlyArray<string>,
    hookId?: number,
  ) =>
    request(
      Redacted.value(token),
      hookId === undefined ? "POST" : "PATCH",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/hooks${hookId === undefined ? "" : `/${hookId}`}`,
      {
        active: true,
        events: [...events],
        config: {
          url: endpointUrl,
          content_type: "json",
          secret: Redacted.value(secret),
          insecure_ssl: "0",
        },
      },
    ).pipe(Effect.asVoid);

  const deleteHook = (
    token: Redacted.Redacted<string>,
    owner: string,
    repository: string,
    hookId: number,
  ) =>
    request(
      Redacted.value(token),
      "DELETE",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/hooks/${hookId}`,
    ).pipe(Effect.asVoid);

  return { installationToken, listHooks, saveHook, deleteHook };
});
