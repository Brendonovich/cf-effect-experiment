import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import * as CloudflareRuntime from "./CloudflareRuntime.ts";

// Alchemy forwards these fields verbatim. Cloudflare rejects explicit
// undefined durations, so require a complete override or use platform defaults.
export interface StepConfig {
  readonly retries: Required<NonNullable<Cloudflare.Workflows.WorkflowStepConfig["retries"]>>;
  readonly timeout: NonNullable<Cloudflare.Workflows.WorkflowStepConfig["timeout"]>;
}

/** Capture the invocation's step service before installing the executor callback. */
export const makeTask = Effect.fnUntraced(function* (config?: StepConfig) {
  const step = yield* Cloudflare.Workflows.WorkflowStep;
  return (<A>(name: string, effect: Effect.Effect<A>) =>
    Cloudflare.Workflows.task(name, effect, config).pipe(
      Effect.provideService(Cloudflare.Workflows.WorkflowStep, step),
    )) satisfies CloudflareRuntime.Task;
});

export interface Options extends CloudflareRuntime.Options {
  readonly stepConfig?: StepConfig;
}

export const makeExecutionEnvironment = Effect.fnUntraced(function* (options: Options = {}) {
  return CloudflareRuntime.makeExecutionEnvironment(yield* makeTask(options.stepConfig), options);
});
