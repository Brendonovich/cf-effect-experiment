import { Project } from "@macrograph/core";
import * as Executor from "@macrograph/execution/Executor";
import { ProjectExecutor } from "@macrograph/project-host";
import * as Cloudflare from "alchemy/Cloudflare";
import { eq } from "drizzle-orm";
import { Cause, Effect, Schema, Tracer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import * as Database from "../database/Database.ts";
import {
	type ProjectExecutionRecord,
	projectEvents,
	projectExecutionNodes,
	projectExecutions,
} from "../database/DatabaseSchema.ts";
import { serviceSpanAnnotations } from "../Observability.ts";
import type { DeploymentObjectKey } from "../deployment/DeploymentObjectKey.ts";
import { DeploymentSnapshotsBucket } from "../Storage.ts";
import * as ExecutorPlugins from "./ExecutorPlugins.ts";
import * as WorkflowRuntime from "./WorkflowRuntime.ts";

const WorkflowNodeStepName = Schema.String.pipe(
	Schema.brand("WorkflowNodeStepName"),
);
type WorkflowNodeStepName = typeof WorkflowNodeStepName.Type;

const ExecutionNodeRecordId = Schema.String.pipe(
	Schema.brand("ExecutionNodeRecordId"),
);

export interface GraphExecutionWorkflowInput {
	readonly executionId: string;
	readonly projectId: string;
	readonly projectEventId: string;
	readonly source: "ingress" | "engine" | "timer" | "internal";
	readonly ingressEventId?: string;
	readonly deploymentId: string;
	readonly r2Key: DeploymentObjectKey;
	readonly pluginId: string;
	readonly eventType: string;
	readonly providerEventId?: string;
	readonly event: string;
	readonly traceContext?: {
		readonly traceId: string;
		readonly spanId: string;
		readonly sampled: boolean;
	};
}

export const nodeStepName = (
	key: Executor.NodeExecutionKey,
): WorkflowNodeStepName =>
	WorkflowNodeStepName.make(
		`runtime-node-v2/${key.kind}/${encodeURIComponent(key.graphId)}/${encodeURIComponent(key.eventNodeId)}/${encodeURIComponent(key.executionPath)}/${encodeURIComponent(key.nodeId)}`,
	);

export default class GraphExecutionWorkflow extends Cloudflare.Workflow<GraphExecutionWorkflow>()(
	"GraphExecutionWorkflow",
	Effect.gen(function* () {
		const snapshotsResource = yield* DeploymentSnapshotsBucket;
		const database = yield* Database.Service;
		const snapshots = yield* Cloudflare.R2.ReadBucket(snapshotsResource);

		const updateExecution = (
			executionId: string,
			values: {
				readonly status: "running" | "complete" | "errored";
				readonly startedAt?: string;
				readonly completedAt?: string;
				readonly error?: string;
			},
		) =>
			database
				.update(projectExecutions)
				.set(values)
				.where(eq(projectExecutions.id, executionId))
				.pipe(Effect.asVoid);

		const updateNodeExecution = (
			executionId: string,
			stepName: WorkflowNodeStepName,
			key: Executor.NodeExecutionKey,
			values: {
				readonly status: "running" | "complete" | "errored";
				readonly startedAt: string;
				readonly completedAt?: string | null;
				readonly error?: string | null;
			},
		) =>
			Effect.gen(function* () {
				const id = ExecutionNodeRecordId.make(`${executionId}:${stepName}`);
				yield* database
					.insert(projectExecutionNodes)
					.values({
						id,
						executionId,
						stepName,
						graphId: key.graphId,
						eventNodeId: key.eventNodeId,
						nodeId: key.nodeId,
						kind: key.kind,
						status: values.status,
						startedAt: values.startedAt,
						completedAt: values.completedAt ?? null,
						error: values.error ?? null,
					})
					.onConflictDoUpdate({
						target: projectExecutionNodes.id,
						set: {
							status: values.status,
							startedAt: values.startedAt,
							completedAt: values.completedAt ?? null,
							error: values.error ?? null,
						},
					});
			});

		return Effect.fnUntraced(function* (input: GraphExecutionWorkflowInput) {
			return yield* Effect.gen(function* () {
				const workflowStep = yield* Cloudflare.Workflows.WorkflowStep;
				yield* Cloudflare.Workflows.task(
					"runtime-execution-v1/queued",
					Effect.gen(function* () {
						const receivedAt = new Date().toISOString();
						const execution: ProjectExecutionRecord = {
							id: input.executionId,
							projectId: input.projectId,
							projectEventId: input.projectEventId,
							deploymentId: input.deploymentId,
							status: "queued",
							receivedAt,
							startedAt: null,
							completedAt: null,
							error: null,
						};
						yield* database.transaction((transaction) =>
							Effect.gen(function* () {
								yield* transaction
									.insert(projectEvents)
									.values({
										id: input.projectEventId,
										projectId: input.projectId,
										source: input.source,
										ingressEventId: input.ingressEventId ?? null,
										pluginId: input.pluginId,
										eventType: input.eventType,
										providerEventId: input.providerEventId ?? null,
										eventPayload: input.event,
										receivedAt,
									})
									.onConflictDoNothing();
								yield* transaction
									.insert(projectExecutions)
									.values(execution)
									.onConflictDoNothing();
							}),
						);
					}).pipe(Effect.orDie),
				);
				yield* Cloudflare.Workflows.task(
					"runtime-execution-v1/running",
					updateExecution(input.executionId, {
						status: "running",
						startedAt: new Date().toISOString(),
					}).pipe(Effect.orDie),
				);
				const project = yield* Cloudflare.Workflows.task(
					`runtime-project-v1/${input.projectId}/${input.deploymentId}`,
					Effect.gen(function* () {
						const object = yield* snapshots.get(input.r2Key);
						if (object === null)
							return yield* Effect.die(
								`Project deployment ${input.r2Key} not found`,
							);
						const json = yield* object.text();
						const value = yield* Effect.try({
							try: () => JSON.parse(json),
							catch: (cause) => cause,
						});
						return yield* Schema.decodeUnknownEffect(Project.Model)(value);
					}).pipe(Effect.orDie),
				);
				const event = yield* Effect.try({
					try: () => JSON.parse(input.event),
					catch: (cause) => cause,
				}).pipe(Effect.orDie);
				if (typeof Executor.make !== "function")
					return yield* Effect.die(
						"Executor.make is unavailable in the Workflow bundle",
					);
				const executionDriver: Executor.ExecutionDriver = {
					executeNode: (key, effect) => {
						const name = nodeStepName(key);
						return Effect.gen(function* () {
							const startedAt = new Date().toISOString();
							yield* Cloudflare.Workflows.task(
								`${name}/trace-start`,
								updateNodeExecution(input.executionId, name, key, {
									status: "running",
									startedAt,
								}).pipe(Effect.orDie),
							);
							const result = yield* Cloudflare.Workflows.task(
								name,
								effect.pipe(
									Effect.orDie,
									Effect.withSpan("GraphExecutionWorkflow.executeNode", {
										annotations: serviceSpanAnnotations(
											"macrograph-execution-workflow",
										),
										attributes: {
											"macrograph.project.id": input.projectId,
											"macrograph.execution.id": input.executionId,
											"macrograph.graph.id": key.graphId,
											"macrograph.event_node.id": key.eventNodeId,
											"macrograph.node.id": key.nodeId,
											"macrograph.node.kind": key.kind,
											"macrograph.execution.path": key.executionPath,
										},
									}),
									Effect.tap(() =>
										Effect.log(
											`Completed runtime workflow step ${name} project ${input.projectId} deployment ${input.deploymentId} execution ${input.executionId}`,
										),
									),
								),
							).pipe(
								Effect.catchCause((cause) =>
									Cloudflare.Workflows.task(
										`${name}/trace-error`,
										updateNodeExecution(input.executionId, name, key, {
											status: "errored",
											startedAt,
											completedAt: new Date().toISOString(),
											error: String(Cause.squash(cause)),
										}).pipe(Effect.orDie),
									).pipe(Effect.andThen(Effect.failCause(cause))),
								),
							);
							yield* Cloudflare.Workflows.task(
								`${name}/trace-complete`,
								updateNodeExecution(input.executionId, name, key, {
									status: "complete",
									startedAt,
									completedAt: new Date().toISOString(),
								}).pipe(Effect.orDie),
							);
							return result;
						}).pipe(
							Effect.provideService(
								Cloudflare.Workflows.WorkflowStep,
								workflowStep,
							),
						);
					},
				};
				const engineClient = yield* WorkflowRuntime.make(project).pipe(
					Effect.provide(FetchHttpClient.layer),
				);
				const executor = yield* ProjectExecutor.make(project, {
					projectId: input.projectId,
					executionDriver,
					plugins: ExecutorPlugins.registry,
					engineClient,
				});
				yield* ExecutorPlugins.registry
					.handle(executor, input.pluginId, event)
					.pipe(Effect.orDie);
				yield* Cloudflare.Workflows.task(
					"runtime-execution-v1/complete",
					updateExecution(input.executionId, {
						status: "complete",
						completedAt: new Date().toISOString(),
					}).pipe(Effect.orDie),
				);
				return {
					completed: true,
					executionId: input.executionId,
					projectId: input.projectId,
					deploymentId: input.deploymentId,
				};
			}).pipe(
				Effect.catchCause((cause) =>
					updateExecution(input.executionId, {
						status: "errored",
						completedAt: new Date().toISOString(),
						error: String(Cause.squash(cause)),
					}).pipe(Effect.orDie, Effect.andThen(Effect.failCause(cause))),
				),
				Effect.withSpan("GraphExecutionWorkflow.execute", {
					kind: "consumer",
					...(input.traceContext === undefined
						? {}
						: { parent: Tracer.externalSpan(input.traceContext) }),
					annotations: serviceSpanAnnotations("macrograph-execution-workflow"),
					attributes: {
						"macrograph.project.id": input.projectId,
						"macrograph.project.event.id": input.projectEventId,
						"macrograph.execution.id": input.executionId,
						"macrograph.deployment.id": input.deploymentId,
						"macrograph.event.source": input.source,
						"macrograph.event.type": input.eventType,
						...(input.ingressEventId === undefined
							? {}
							: { "macrograph.ingress.event.id": input.ingressEventId }),
					},
				}),
			);
		});
	}),
) {}
