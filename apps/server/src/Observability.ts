import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

import type { makeServerConfig } from "./ServerConfig.ts";

export const layer = (
  config: Pick<
    ReturnType<typeof makeServerConfig>,
    "otlpEndpoint" | "otlpHeaders" | "otlpServiceName"
  >,
) =>
  config.otlpEndpoint === undefined
    ? Layer.empty
    : OtlpTracer.layer({
        url: config.otlpEndpoint,
        headers: config.otlpHeaders,
        resource: { serviceName: config.otlpServiceName },
        exportInterval: "1 second",
      }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));

export * as Observability from "./Observability.ts";
