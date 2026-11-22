import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

import { Integrity } from "./Integrity.ts";
import { Protocol } from "./Protocol.ts";
import { Signing } from "./Signing.ts";

/** The registry could not be reached or answered with something that isn't valid protocol data. */
export class ClientError extends Schema.TaggedError<ClientError>()("RegistryClientError", {
  url: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class PackageNotFound extends Schema.TaggedError<PackageNotFound>()(
  "RegistryPackageNotFound",
  { url: Schema.String, publisher: Schema.String, name: Schema.String },
) {}

export class ReleaseVerificationFailed extends Schema.TaggedError<ReleaseVerificationFailed>()(
  "RegistryReleaseVerificationFailed",
  {
    publisher: Schema.String,
    name: Schema.String,
    version: Schema.String,
    check: Schema.Literals(["integrity", "signature"]),
    message: Schema.String,
  },
) {}

export const DefaultMaxTarballBytes = 64 * 1024 * 1024;

export interface Options {
  /** Largest tarball the client downloads. Defaults to 64 MiB. */
  readonly maxTarballBytes?: number;
}

export interface Client {
  /** The registry's base URL without a trailing slash. */
  readonly url: string;
  readonly metadata: Effect.Effect<Protocol.Metadata, ClientError>;
  readonly index: Effect.Effect<Protocol.Index, ClientError>;
  readonly getPackage: (
    publisher: string,
    name: string,
  ) => Effect.Effect<Protocol.Package, ClientError | PackageNotFound>;
  /** Uses `/v1/search?q=` when the registry serves it, otherwise filters `index.json`. */
  readonly search: (
    query: string,
  ) => Effect.Effect<ReadonlyArray<Protocol.IndexEntry>, ClientError>;
  /** Resolves a release's tarball URL; relative URLs are relative to the registry URL. */
  readonly tarballUrl: (release: Protocol.Release) => string;
  /** Downloads a tarball without verifying it. */
  readonly download: (
    release: Protocol.Release,
  ) => Effect.Effect<Uint8Array<ArrayBuffer>, ClientError>;
}

/** Strips trailing slashes and rejects URLs that aren't http(s). */
export const normalizeUrl = (url: string): Effect.Effect<string, ClientError> =>
  Effect.try({
    try: () => {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
        throw new Error("Registry URLs must use http or https");
      parsed.hash = "";
      parsed.search = "";
      return parsed.toString().replace(/\/+$/, "");
    },
    catch: (cause) =>
      new ClientError({ url, message: cause instanceof Error ? cause.message : "Invalid URL" }),
  });

/** Case-insensitive match on publisher, name, display name and description. */
export const matchesQuery = (entry: Protocol.IndexEntry, query: string) => {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return true;
  const haystack = [`${entry.publisher}/${entry.name}`, entry.displayName, entry.description ?? ""]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
};

const errorMessage = (cause: unknown, fallback: string) =>
  typeof cause === "object" &&
  cause !== null &&
  "message" in cause &&
  typeof cause.message === "string"
    ? cause.message
    : fallback;

export const make = (
  url: string,
  options: Options = {},
): Effect.Effect<Client, ClientError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const base = yield* normalizeUrl(url);
    const http = yield* HttpClient.HttpClient;
    const maxTarballBytes = options.maxTarballBytes ?? DefaultMaxTarballBytes;

    /** Protocol paths are relative to the registry URL, which may include a path. */
    const resolve = (path: string) => `${base}${path}`;

    const request = (target: string) =>
      http
        .execute(HttpClientRequest.get(target).pipe(HttpClientRequest.acceptJson))
        .pipe(
          Effect.mapError(
            (cause) =>
              new ClientError({
                url: target,
                message: errorMessage(cause, "Request failed"),
                cause,
              }),
          ),
        );

    const ok = (
      target: string,
      response: HttpClientResponse.HttpClientResponse,
    ): Effect.Effect<HttpClientResponse.HttpClientResponse, ClientError> =>
      response.status >= 200 && response.status < 300
        ? Effect.succeed(response)
        : Effect.fail(
            new ClientError({ url: target, message: `Registry responded with ${response.status}` }),
          );

    const json = <A>(
      target: string,
      response: HttpClientResponse.HttpClientResponse,
      schema: Schema.ConstraintDecoder<A>,
    ): Effect.Effect<A, ClientError> =>
      response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
        Effect.mapError(
          (cause) =>
            new ClientError({
              url: target,
              message: `Invalid registry response: ${errorMessage(cause, "decode failed")}`,
              cause,
            }),
        ),
      );

    const getJson = <A>(path: string, schema: Schema.ConstraintDecoder<A>) => {
      const target = resolve(path);
      return request(target).pipe(
        Effect.flatMap((response) => ok(target, response)),
        Effect.flatMap((response) => json(target, response, schema)),
      );
    };

    const index = getJson(Protocol.IndexPath, Protocol.Index);

    const getPackage = (publisher: string, name: string) => {
      const target = resolve(Protocol.packagePath(publisher, name));
      return request(target).pipe(
        Effect.flatMap(
          (
            response,
          ): Effect.Effect<HttpClientResponse.HttpClientResponse, ClientError | PackageNotFound> =>
            response.status === 404
              ? Effect.fail(new PackageNotFound({ url: target, publisher, name }))
              : ok(target, response),
        ),
        Effect.flatMap((response) => json(target, response, Protocol.Package)),
        Effect.flatMap((pkg) =>
          pkg.publisher === publisher && pkg.name === name
            ? Effect.succeed(pkg)
            : Effect.fail(
                new ClientError({ url: target, message: "Package document names another package" }),
              ),
        ),
      );
    };

    const filterIndex = (query: string) =>
      Effect.map(index, ({ packages }) => packages.filter((entry) => matchesQuery(entry, query)));

    const search = (query: string) => {
      const target = `${resolve(Protocol.SearchPath)}?q=${encodeURIComponent(query)}`;
      return request(target).pipe(
        Effect.flatMap((response) => ok(target, response)),
        Effect.flatMap((response) => json(target, response, Protocol.Index)),
        Effect.map(({ packages }) => packages),
        Effect.catch(() => filterIndex(query)),
      );
    };

    const tarballUrl = (release: Protocol.Release) =>
      new URL(release.tarball, `${base}/`).toString();

    const download = (release: Protocol.Release) => {
      const target = tarballUrl(release);
      return request(target).pipe(
        Effect.flatMap((response) => ok(target, response)),
        Effect.flatMap((response) => {
          const length = Number(response.headers["content-length"] ?? Number.NaN);
          return Number.isFinite(length) && length > maxTarballBytes
            ? Effect.fail(new ClientError({ url: target, message: "Tarball is too large" }))
            : response.arrayBuffer.pipe(
                Effect.mapError(
                  (cause) =>
                    new ClientError({
                      url: target,
                      message: errorMessage(cause, "Download failed"),
                      cause,
                    }),
                ),
              );
        }),
        Effect.flatMap((buffer) =>
          buffer.byteLength > maxTarballBytes
            ? Effect.fail(new ClientError({ url: target, message: "Tarball is too large" }))
            : Effect.succeed(new Uint8Array(buffer)),
        ),
      );
    };

    return {
      url: base,
      metadata: getJson(Protocol.WellKnownPath, Protocol.Metadata),
      index,
      getPackage,
      search,
      tarballUrl,
      download,
    } satisfies Client;
  });

/**
 * Verifies a release record's signature against the registry's pinned keys. The namespace is the
 * registry's own namespace, so a record can't be replayed from another registry.
 */
export const verifySignature = (
  keys: ReadonlyArray<Protocol.SigningKey>,
  namespace: string,
  pkg: { readonly publisher: string; readonly name: string },
  release: Protocol.Release,
): Effect.Effect<void, ReleaseVerificationFailed> =>
  Signing.verifyRelease(
    keys,
    Protocol.signedRecord(namespace, pkg, release),
    release.signature,
  ).pipe(
    Effect.mapError(
      (error) =>
        new ReleaseVerificationFailed({
          publisher: pkg.publisher,
          name: pkg.name,
          version: release.version,
          check: "signature",
          message:
            error._tag === "RegistrySignatureInvalid"
              ? error.message
              : "Could not verify signature",
        }),
    ),
  );

/** Checks downloaded tarball bytes against the release's integrity hash. */
export const verifyIntegrity = (
  pkg: { readonly publisher: string; readonly name: string },
  release: Protocol.Release,
  bytes: Uint8Array<ArrayBuffer>,
): Effect.Effect<void, ReleaseVerificationFailed> =>
  Integrity.verify(bytes, release.integrity).pipe(
    Effect.mapError(
      (error) =>
        new ReleaseVerificationFailed({
          publisher: pkg.publisher,
          name: pkg.name,
          version: release.version,
          check: "integrity",
          message:
            error._tag === "IntegrityMismatch"
              ? `Expected ${error.expected}, got ${error.actual}`
              : "Could not hash tarball",
        }),
    ),
  );

/** Verifies the signature, downloads the tarball, and checks its integrity. */
export const downloadVerified = (
  client: Client,
  keys: ReadonlyArray<Protocol.SigningKey>,
  namespace: string,
  pkg: { readonly publisher: string; readonly name: string },
  release: Protocol.Release,
): Effect.Effect<Uint8Array<ArrayBuffer>, ClientError | ReleaseVerificationFailed> =>
  Effect.gen(function* () {
    yield* verifySignature(keys, namespace, pkg, release);
    const bytes = yield* client.download(release);
    yield* verifyIntegrity(pkg, release, bytes);
    return bytes;
  });

export * as Client from "./Client.ts";
