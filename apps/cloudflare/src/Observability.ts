import { Config, Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

export const ObservabilityLayer = Layer.unwrap(
  Effect.gen(function* () {
    const envs = yield* Config.all({
      token: Config.redacted("AXIOM_API_TOKEN"),
      dataset: Config.string("AXIOM_DATASET"),
    }).pipe(Effect.orDie);

    return OtlpTracer.layer({
      url: "https://api.axiom.co/v1/traces",
      headers: {
        Authorization: `Bearer ${Redacted.value(envs.token)}`,
        "X-Axiom-Dataset": envs.dataset,
      },
      resource: {
        serviceName: "macrograph",
      },
      exportInterval: "1 second",
    }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));

    // return Option.match(envs, {
    // 	onNone: () => Layer.empty,
    // 	onSome: (envs) =>
    // 		OtlpTracer.layer({
    // 			url: "https://api.axiom.co/v1/traces",
    // 			headers: {
    // 				Authorization: `Bearer ${Redacted.value(envs.token)}`,
    // 				"X-Axiom-Dataset": envs.dataset,
    // 			},
    // 			resource: {
    // 				serviceName: "macrograph",
    // 			},
    // 			exportInterval: "1 second",
    // 		}).pipe(Layer.provide(OtlpSerialization.layerJson)),
    // });
  }),
);
