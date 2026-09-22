import type { Project } from "@macrograph/core";

import { Function as GraphFunction } from "@macrograph/core";
import { Editor, EditorEvents, Packages, QueueRuntime } from "@macrograph/editor";
import { Executor, RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { ProjectQueues } from "@macrograph/project-host";
import { Context, Effect, Layer, Option, Stream } from "effect";

export interface Options {
  readonly projectId?: string;
  readonly initialProject?: Project.Model;
}

/** A mutable, editor-backed project executor kept synchronized with persisted changes. */
export class Service extends Context.Service<Service, Executor.Service>()(
  "macrograph/live-runtime/LiveRuntime",
) {}

export const make = Effect.fnUntraced(function* (options: Options = {}) {
  const persistence = yield* Persistence.Service;
  const editor = yield* Editor.Service;
  const events = yield* EditorEvents.Service;
  const packages = yield* Packages.Service;
  yield* packages.loadPackage(GraphFunction.queuePackageModel);
  const activity = yield* RuntimeActivity.Service;
  const initialProject = options.initialProject;
  const project = yield* initialProject === undefined
    ? persistence.loadProject()
    : persistence
        .loadProject()
        .pipe(
          Effect.catchTag("ProjectNotFoundError", () =>
            persistence.saveProject(initialProject).pipe(Effect.as(initialProject)),
          ),
        );
  const hosted = yield* ProjectQueues.make(project, {
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    executionEnvironment: activity.executionEnvironment,
    engineClient: (moduleId) => editor.engine.getRuntimeClient(moduleId).pipe(Effect.orDie),
    resourceValues: ({ package: moduleId, resource }) =>
      editor.engine.getResourceValues(moduleId, resource).pipe(Effect.orDie),
  });
  const executor = hosted.executor;
  const queueMount = yield* Effect.serviceOption(QueueRuntime.Mount);
  if (Option.isSome(queueMount)) yield* queueMount.value.set(hosted.queues);
  yield* Stream.fromSubscription(yield* events.subscribe).pipe(
    Stream.runForEach(() =>
      persistence.loadProject().pipe(Effect.flatMap(executor.loadProject), Effect.orDie),
    ),
    Effect.forkScoped,
  );
  return activity.wrap(executor);
});

export const layer = (options: Options = {}) =>
  Layer.effect(Service)(make(options).pipe(Effect.map(Service.of)));

export * as LiveRuntime from "./LiveRuntime.ts";
