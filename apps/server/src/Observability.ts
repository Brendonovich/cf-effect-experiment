import { Effect, Layer, Result } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { OtlpSerialization, OtlpTracer } from "effect/observability";

import type { makeServerConfig, OtlpTraceDestination } from "./ServerConfig.ts";

/**
 * Re-sends every trace export POST to all configured destinations.
 *
 * Spans are serialized once and sent verbatim, so trace and span ids stay
 * identical across destinations. Effect exposes a single `Tracer` service, so
 * one tracer per destination would generate divergent ids.
 */
const fanoutClient = (routes: ReadonlyMap<string, ReadonlyArray<OtlpTraceDestination>>) =>
  Layer.effect(HttpClient.HttpClient)(
    Effect.gen(function* () {
      const base = yield* HttpClient.HttpClient;
      return HttpClient.transform(base, (effect, request) => {
        const targets = routes.get(request.url);
        if (targets === undefined) return effect;
        return Effect.gen(function* () {
          const results = yield* Effect.all(
            targets.map((target) =>
              Effect.result(
                base.execute(
                  request.pipe(
                    HttpClientRequest.setUrl(target.url),
                    HttpClientRequest.setHeaders(target.headers),
                  ),
                ),
              ),
            ),
            { concurrency: "unbounded" },
          );
          // One healthy destination keeps the exporter alive.
          const healthy = results.find(
            (result) =>
              Result.isSuccess(result) &&
              result.success.status >= 200 &&
              result.success.status < 300,
          );
          const anySuccess = healthy ?? results.find((result) => Result.isSuccess(result));
          if (anySuccess !== undefined && Result.isSuccess(anySuccess)) {
            for (const result of results) {
              if (result !== anySuccess && Result.isFailure(result)) {
                yield* Effect.logDebug("Telemetry destination failed", result.failure);
              }
            }
            return anySuccess.success;
          }
          const failure = results.find((result) => Result.isFailure(result));
          return yield* failure !== undefined && Result.isFailure(failure)
            ? Effect.fail(failure.failure)
            : effect;
        });
      });
    }),
  );

export const layer = (
  config: Pick<ReturnType<typeof makeServerConfig>, "otlpDestinations" | "otlpServiceName">,
) => {
  const [primary] = config.otlpDestinations;
  if (primary === undefined) return Layer.empty;
  // The tracer posts to the first destination's URL; the fanout client applies
  // each destination's own headers so credentials never leak between them.
  // Effect logs reach traces as span events through the default tracer logger.
  return OtlpTracer.layer({
    url: primary.url,
    resource: { serviceName: config.otlpServiceName },
    exportInterval: "1 second",
  }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(fanoutClient(new Map([[primary.url, config.otlpDestinations]]))),
    Layer.provide(FetchHttpClient.layer),
  );
};

export * as Observability from "./Observability.ts";
