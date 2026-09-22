import { Schema } from "effect";

import { DeploymentObjectKey } from "../deployment/DeploymentObjectKey.ts";

export const Scope = Schema.Struct({
  projectId: Schema.String,
  deploymentId: Schema.String,
  r2Key: DeploymentObjectKey,
});
export type Scope = typeof Scope.Type;

export const Work = Schema.Struct({
  ...Scope.fields,
  id: Schema.String,
  queueId: Schema.String,
  functionId: Schema.String,
  values: Schema.Record(Schema.String, Schema.Unknown),
  queueLineage: Schema.Array(Schema.String),
  executionPath: Schema.String,
});
export type Work = typeof Work.Type;

// Queue deliveries carry identity only. Arguments and snapshot identity are captured at admission.
export const Delivery = Schema.Struct({
  ...Scope.fields,
  id: Schema.String,
  queueId: Schema.String,
});
export type Delivery = typeof Delivery.Type;

export const Outcome = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), values: Schema.Record(Schema.String, Schema.Unknown) }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
]);
export type Outcome = typeof Outcome.Type;

export const scopeKey = (scope: Scope) => JSON.stringify([scope.projectId, scope.deploymentId]);

export const workId = async (scope: Scope, parentId: string, executionPath: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([scope.projectId, scope.deploymentId, parentId, executionPath]),
    ),
  );
  return `fq-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

export interface WorkflowStatus {
  readonly status: string;
  readonly output?: unknown;
  readonly error?: { readonly message: string } | null;
}

export interface WorkflowBinding {
  readonly create: (options: { readonly id: string; readonly params: Work }) => Promise<unknown>;
  readonly get: (id: string) => Promise<{
    readonly status: () => Promise<WorkflowStatus>;
    readonly terminate: () => Promise<void>;
  }>;
}

export const workflowBinding = (value: unknown): WorkflowBinding => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("create" in value) ||
    typeof value.create !== "function" ||
    !("get" in value) ||
    typeof value.get !== "function"
  )
    throw new Error("FunctionExecutionWorkflow binding is unavailable");
  return value as WorkflowBinding;
};

export const queueBinding = (
  value: unknown,
): { readonly send: (delivery: Delivery) => Promise<void> } => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("send" in value) ||
    typeof value.send !== "function"
  )
    throw new Error("FunctionWorkQueue binding is unavailable");
  return value as { readonly send: (delivery: Delivery) => Promise<void> };
};

export const terminal = (status: WorkflowStatus) =>
  status.status === "complete" || status.status === "errored" || status.status === "terminated";
