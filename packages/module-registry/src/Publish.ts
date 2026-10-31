import { Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpIncomingMessage } from "effect/http";

import { Protocol } from "./Protocol.ts";

/**
 * Publishing is an optional registry extra: the official registry accepts a module package
 * tarball (`.tgz` of the package folder, paths relative to it) and reads the identity and
 * version from its `macrograph.json`.
 */
export const PublishPath = "/api/v1/publish";
export const TarballContentType = "application/gzip";

/** JSON body of every non-2xx response from the registry's service API. */
export const ErrorBody = Schema.Struct({
  _tag: Schema.String,
  message: Schema.String,
  problems: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type ErrorBody = typeof ErrorBody.Type;

export class PublishError extends Schema.TaggedError<PublishError>()("RegistryPublishError", {
  status: Schema.Number,
  /** The registry's error tag, e.g. `InvalidPackage`, `VersionExists`, `PublisherNotApproved`. */
  reason: Schema.String,
  message: Schema.String,
  problems: Schema.Array(Schema.String),
}) {}

export interface Options {
  /** Registry base URL, e.g. `https://registry.macrograph.app`. */
  readonly registry: string;
  /** MacroGraph account API token (`mg_…`). */
  readonly token: string;
  readonly tarball: Uint8Array;
}

const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

/** Publishes a package tarball and returns the signed release record the registry created. */
export const publish = (options: Options) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const url = new URL(PublishPath, options.registry);
    const response = yield* client.execute(
      HttpClientRequest.post(url).pipe(
        HttpClientRequest.bearerToken(options.token),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyUint8Array(options.tarball, TarballContentType),
      ),
    );
    if (response.status >= 200 && response.status < 300)
      return yield* HttpIncomingMessage.schemaBodyJson(Protocol.Release)(response);
    const body = yield* response.json.pipe(Effect.option);
    const error = Option.flatMap(body, decodeErrorBody);
    return yield* new PublishError({
      status: response.status,
      reason: Option.match(error, { onNone: () => "HttpError", onSome: (value) => value._tag }),
      message: Option.match(error, {
        onNone: () => `Registry responded with status ${response.status}`,
        onSome: (value) => value.message,
      }),
      problems: Option.match(error, {
        onNone: () => [],
        onSome: (value) => value.problems ?? [],
      }),
    });
  });

export * as Publish from "./Publish.ts";
