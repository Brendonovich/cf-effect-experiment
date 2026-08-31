import { Project } from "@macrograph/core";
import { Editor, EditorEvents } from "@macrograph/editor";
import { Executor, RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { ProjectExecutor } from "@macrograph/project-host";
import { Context, Effect, Layer, Stream } from "effect";

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
    const scope = yield* Effect.scope;
    const project = yield* persistence.loadProject().pipe(
      Effect.catchTag("ProjectNotFoundError", () => {
        const project = { ...Project.empty(), name: "test" };
        return persistence.saveProject(project).pipe(Effect.as(project));
      }),
    );
    const executor = yield* ProjectExecutor.make(project, {
      customEvents: {
        scope,
        track: (name, payload, handler) =>
          activity.track("project-events", { _tag: name, payload }, handler),
      },
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
