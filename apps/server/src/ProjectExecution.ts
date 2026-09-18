import { Project } from "@macrograph/core";
import { Editor, EditorEvents, QueueRuntime } from "@macrograph/editor";
import { Executor, RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { ProjectQueues } from "@macrograph/project-host";
import { Context, Effect, Layer, Option, Stream } from "effect";

/** Provides the project executor and keeps it synchronized with persisted editor changes. */
export class Service extends Context.Service<Service, Executor.Service>()(
  "macrograph/server/ProjectExecution",
) {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    const editor = yield* Editor.Service;
    const events = yield* EditorEvents.Service;
    const activity = yield* RuntimeActivity.Service;
    const project = yield* persistence.loadProject().pipe(
      Effect.catchTag("ProjectNotFoundError", () => {
        const project = { ...Project.empty(), name: "test" };
        return persistence.saveProject(project).pipe(Effect.as(project));
      }),
    );
    const { executor, queues } = yield* ProjectQueues.make(project, {
      executionDriver: activity.executionDriver,
      engineClient: (pluginId) =>
        Effect.succeed(
          new Proxy(
            {},
            {
              get:
                (_target, property) =>
                (...args: ReadonlyArray<unknown>) =>
                  editor.engine.getRuntimeClient(pluginId).pipe(
                    Effect.flatMap((client) => {
                      const method = Reflect.get(Object(client), property);
                      return typeof method === "function"
                        ? method(...args)
                        : Effect.die(`Engine ${pluginId} has no ${String(property)} RPC`);
                    }),
                  ),
            },
          ),
        ),
    });
    const mount = yield* Effect.serviceOption(QueueRuntime.Mount);
    if (Option.isSome(mount)) yield* mount.value.set(queues);
    yield* Stream.fromSubscription(yield* events.subscribe).pipe(
      Stream.runForEach(() =>
        persistence.loadProject().pipe(Effect.flatMap(executor.loadProject), Effect.orDie),
      ),
      Effect.forkScoped,
    );

    return Service.of(activity.wrap(executor));
  }),
);

export * as ProjectExecution from "./ProjectExecution.ts";
