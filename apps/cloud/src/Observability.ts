import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Axiom from "alchemy/Axiom";
import { retain } from "alchemy/RemovalPolicy";
import { ConfigProvider, Context, Effect, Layer, Option, Tracer } from "effect";

export const traceDatasetName = "macrograph-traces";
export const axiomConfigured = () => Boolean(process.env.AXIOM_TOKEN || process.env.AXIOM_API_KEY);

const traces = Axiom.Dataset("MacroGraphTraces", {
  name: traceDatasetName,
  kind: "otel:traces:v1",
  retentionDays: 30,
  useRetentionPeriod: true,
  // Every stage adopts this shared dataset; retain it so destroying a preview
  // stage never deletes production's traces.
}).pipe(adopt(true), retain());

const ingestToken = Axiom.ApiToken("MacroGraphTraceIngestToken", {
  name: "macrograph-trace-ingest",
  description: "OTLP trace ingestion for MacroGraph",
  datasetCapabilities: {
    [traceDatasetName]: { ingest: ["create"] },
  },
});

const builtInTelemetry = Context.get(Context.empty(), Alchemy.Telemetry.Telemetry);

type ServiceName =
  | "macrograph-cloud-worker"
  | "macrograph-project-ingress-do"
  | "macrograph-execution-workflow";

const TraceServiceName = Context.Reference<ServiceName | undefined>(
  "macrograph/Observability/TraceServiceName",
  { defaultValue: () => undefined },
);

export const serviceSpanAnnotations = (serviceName: ServiceName) =>
  Context.add(Context.empty(), TraceServiceName, serviceName);

const resourceTracer = (serviceName: ServiceName) =>
  Layer.fresh(builtInTelemetry).pipe(
    Layer.provide(
      ConfigProvider.layerAdd(ConfigProvider.fromEnv({ env: { OTEL_SERVICE_NAME: serviceName } }), {
        asPrimary: true,
      }),
    ),
  );

const routedTracer = Layer.effect(Tracer.Tracer)(
  Effect.gen(function* () {
    const workerTracer = Context.get(
      yield* Layer.build(resourceTracer("macrograph-cloud-worker")),
      Tracer.Tracer,
    );
    const ingressTracer = Context.get(
      yield* Layer.build(resourceTracer("macrograph-project-ingress-do")),
      Tracer.Tracer,
    );
    const workflowTracer = Context.get(
      yield* Layer.build(resourceTracer("macrograph-execution-workflow")),
      Tracer.Tracer,
    );
    return Tracer.make({
      context: workerTracer.context,
      span(options) {
        const serviceName = Context.get(options.annotations, TraceServiceName);
        const tracer =
          serviceName === "macrograph-project-ingress-do"
            ? ingressTracer
            : serviceName === "macrograph-execution-workflow"
              ? workflowTracer
              : workerTracer;
        const annotations = Context.add(options.annotations, TraceServiceName, serviceName);
        return tracer.span(
          options.kind === "server"
            ? {
                ...options,
                annotations,
                parent: Option.none(),
                root: true,
                sampled: true,
              }
            : { ...options, annotations },
        );
      },
    });
  }),
);

export const ObservabilityLayer = axiomConfigured()
  ? Layer.mergeAll(
      Axiom.Telemetry({
        token: ingestToken,
        traces,
        serviceName: "macrograph-cloud-worker",
      }),
      Alchemy.Telemetry.layer(routedTracer),
    )
  : Layer.empty;
