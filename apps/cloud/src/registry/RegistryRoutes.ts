import { Protocol } from "@macrograph/module-registry/Protocol";
import { Publish } from "@macrograph/module-registry/Publish";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { requestOrigin } from "../api/HttpOrigin.ts";
import * as Errors from "./Errors.ts";
import * as Registry from "./Registry.ts";
import * as RegistryConfig from "./RegistryConfig.ts";

export const ApplyPath = "/api/v1/publishers";
export const AdminPublishersPath = "/api/v1/admin/publishers";
export const AdminReleasesPath = "/api/v1/admin/releases";

const PublisherStatus = Schema.Literals(["pending", "approved", "suspended"]);

export const ApplyBody = Schema.Struct({ name: Schema.String });

export const PublisherUpdateBody = Schema.Struct({
  account: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(PublisherStatus),
  trusted: Schema.optionalKey(Schema.Boolean),
});

export const ReleaseUpdateBody = Schema.Struct({
  trust: Schema.optionalKey(Schema.NullOr(Protocol.Trust)),
  status: Schema.optionalKey(Protocol.ReleaseStatus),
  reason: Schema.optionalKey(Schema.String),
});

const publicHeaders = {
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60",
};

const errorResponse = (error: Errors.RegistryError) =>
  HttpServerResponse.jsonUnsafe(
    {
      _tag: error._tag,
      message: error.message,
      ...(error._tag === "InvalidPackage" ? { problems: error.problems } : {}),
    } satisfies Publish.ErrorBody,
    { status: Errors.status(error), headers: { "cache-control": "no-store" } },
  );

const handle = <R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, Errors.RegistryError, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catch((error) => Effect.succeed(errorResponse(error))),
    Effect.catchCause((cause) =>
      Effect.logError("Registry request failed", cause).pipe(
        Effect.as(HttpServerResponse.empty({ status: 500 })),
      ),
    ),
  );

const json = (body: unknown, headers: Record<string, string> = { "cache-control": "no-store" }) =>
  HttpServerResponse.jsonUnsafe(body, { headers });

const encode =
  <S extends Schema.Encoder<unknown>>(schema: S) =>
  (value: S["Type"]) =>
    Schema.encodeEffect(schema)(value).pipe(Effect.orDie);

const readJson = <S extends Schema.Decoder<unknown>>(
  request: HttpServerRequest.HttpServerRequest,
  schema: S,
) =>
  request.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(() => new Errors.InvalidRequest({ message: "The request body is invalid" })),
  );

const strip = (value: string | undefined, suffix: string) =>
  value !== undefined && value.endsWith(suffix) ? value.slice(0, -suffix.length) : undefined;

/**
 * The official registry: the static protocol (`/.well-known/…`, `/v1/…`) plus the publish and admin
 * API under `/api/v1/…`. API requests authenticate with a MacroGraph API token.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;
    const registry = yield* Registry.Service;
    const config = yield* RegistryConfig.Service;

    const authenticate = (request: HttpServerRequest.HttpServerRequest) =>
      registry.authenticate(request.headers.authorization);

    yield* router.add("GET", Protocol.WellKnownPath, () =>
      handle(
        registry.metadata.pipe(
          Effect.flatMap(encode(Protocol.Metadata)),
          Effect.map((body) => json(body, publicHeaders)),
        ),
      ),
    );

    yield* router.add("GET", Protocol.IndexPath, () =>
      handle(
        registry.index.pipe(
          Effect.flatMap(encode(Protocol.Index)),
          Effect.map((body) => json(body, publicHeaders)),
        ),
      ),
    );

    yield* router.add("GET", Protocol.SearchPath, (request) =>
      handle(
        registry
          .search(new URL(request.url, "http://registry.local").searchParams.get("q") ?? "")
          .pipe(
            Effect.flatMap(encode(Protocol.Index)),
            Effect.map((body) => json(body, publicHeaders)),
          ),
      ),
    );

    yield* router.add("GET", "/v1/packages/:publisher/:file", (request) =>
      handle(
        Effect.gen(function* () {
          const { publisher, file } = yield* HttpRouter.params;
          const name = strip(file, ".json");
          if (publisher === undefined || name === undefined)
            return yield* new Errors.PackageNotFound({ message: "Package not found" });
          const pkg = yield* registry.package(publisher, name, requestOrigin(request));
          return json(yield* encode(Protocol.Package)(pkg), publicHeaders);
        }),
      ),
    );

    yield* router.add("GET", "/v1/tarballs/:publisher/:name/:file", () =>
      handle(
        Effect.gen(function* () {
          const { publisher, name, file } = yield* HttpRouter.params;
          const version = strip(file, ".tgz");
          if (publisher === undefined || name === undefined || version === undefined)
            return yield* new Errors.ReleaseNotFound({ message: "Release not found" });
          const bytes = yield* registry.tarball(publisher, name, version);
          return HttpServerResponse.uint8Array(bytes, {
            contentType: Publish.TarballContentType,
            headers: {
              "access-control-allow-origin": "*",
              "cache-control": "public, max-age=31536000, immutable",
            },
          });
        }),
      ),
    );

    yield* router.add("POST", Publish.PublishPath, (request) =>
      handle(
        Effect.gen(function* () {
          const actor = yield* authenticate(request);
          const length = Number(request.headers["content-length"] ?? "0");
          if (length > config.limits.maxTarballBytes)
            return yield* new Errors.InvalidPackage({
              message: "The tarball is too large",
              problems: [`The tarball exceeds ${config.limits.maxTarballBytes} bytes`],
            });
          const body = yield* request.arrayBuffer.pipe(
            Effect.mapError(
              () => new Errors.InvalidRequest({ message: "The request body could not be read" }),
            ),
          );
          const release = yield* registry.publish(
            actor,
            new Uint8Array(body),
            requestOrigin(request),
          );
          return HttpServerResponse.jsonUnsafe(yield* encode(Protocol.Release)(release), {
            status: 201,
            headers: { "cache-control": "no-store" },
          });
        }),
      ),
    );

    yield* router.add("POST", ApplyPath, (request) =>
      handle(
        Effect.gen(function* () {
          const actor = yield* authenticate(request);
          const { name } = yield* readJson(request, ApplyBody);
          return json(yield* registry.applyForPublisher(actor, name));
        }),
      ),
    );

    yield* router.add("GET", AdminPublishersPath, (request) =>
      handle(
        Effect.gen(function* () {
          const actor = yield* authenticate(request);
          return json({ publishers: yield* registry.listPublishers(actor) });
        }),
      ),
    );

    yield* router.add("PATCH", `${AdminPublishersPath}/:publisher`, (request) =>
      handle(
        Effect.gen(function* () {
          const actor = yield* authenticate(request);
          const { publisher } = yield* HttpRouter.params;
          const update = yield* readJson(request, PublisherUpdateBody);
          return json(yield* registry.updatePublisher(actor, publisher ?? "", update));
        }),
      ),
    );

    yield* router.add("PATCH", `${AdminReleasesPath}/:publisher/:name/:version`, (request) =>
      handle(
        Effect.gen(function* () {
          const actor = yield* authenticate(request);
          const { publisher, name, version } = yield* HttpRouter.params;
          const update = yield* readJson(request, ReleaseUpdateBody);
          const release = yield* registry.updateRelease(
            actor,
            publisher ?? "",
            name ?? "",
            version ?? "",
            update,
            requestOrigin(request),
          );
          return json(yield* encode(Protocol.Release)(release));
        }),
      ),
    );
  }),
);
