import * as Alchemy from "alchemy";
import { adopt } from "alchemy/AdoptPolicy";
import * as Axiom from "alchemy/Axiom";
import { ConfigProvider, Context, Effect, Layer, Option, Tracer } from "effect";

export const traceDatasetName = "macrograph-traces";

const traces = Axiom.Dataset("MacroGraphTraces", {
	name: traceDatasetName,
	kind: "otel:traces:v1",
	retentionDays: 30,
	useRetentionPeriod: true,
}).pipe(adopt(true));

const ingestToken = Axiom.ApiToken("MacroGraphTraceIngestToken", {
	name: "macrograph-trace-ingest",
	description: "OTLP trace ingestion for MacroGraph",
	datasetCapabilities: {
		[traceDatasetName]: { ingest: ["create"] },
	},
});

const builtInTelemetry = Context.get(
	Context.empty(),
	Alchemy.Telemetry.Telemetry,
);

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
			ConfigProvider.layerAdd(
				ConfigProvider.fromEnv({ env: { OTEL_SERVICE_NAME: serviceName } }),
				{
					asPrimary: true,
				},
			),
		),
	);

const routedTracer = Layer.effect(Tracer.Tracer)(
	Effect.gen(function* () {
		const entrypoint = yield* Alchemy.Telemetry.CurrentEventEntrypoint;
		const serviceName: ServiceName =
			entrypoint === "ProjectIngressDO"
				? "macrograph-project-ingress-do"
				: entrypoint === "GraphExecutionWorkflow"
					? "macrograph-execution-workflow"
					: "macrograph-cloud-worker";
		const tracer = Context.get(
			yield* Layer.build(resourceTracer(serviceName)),
			Tracer.Tracer,
		);
		return Tracer.make({
			context: tracer.context,
			span(options) {
				const annotations = Context.add(
					options.annotations,
					TraceServiceName,
					serviceName,
				);
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

export const ObservabilityLayer = Layer.mergeAll(
	Axiom.Telemetry({
		token: ingestToken,
		traces,
		serviceName: "macrograph-cloud-worker",
	}),
	Alchemy.Telemetry.layer(routedTracer),
);
