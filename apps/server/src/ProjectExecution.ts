import { Project } from "@macrograph/core";
import { ProjectPubSub } from "@macrograph/editor";
import { Executor } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { ProjectExecutor } from "@macrograph/project-host";
import { Context, Effect, Layer, Stream } from "effect";

export class Service extends Context.Service<Service, Executor.Service>()(
	"macrograph/server/ProjectExecution",
) {}

export const layer = Layer.effect(
	Service,
	Effect.gen(function* () {
		const persistence = yield* Persistence.Service;
		const projectPubSub = yield* ProjectPubSub.Service;
		const project = yield* persistence.loadProject().pipe(
			Effect.catchTag("ProjectNotFoundError", () => {
				const project = { ...Project.empty(), name: "test" };
				return persistence.saveProject(project).pipe(Effect.as(project));
			}),
		);
		const executor = yield* ProjectExecutor.make(project);
		yield* Stream.fromSubscription(yield* projectPubSub.subscribe).pipe(
			Stream.runForEach(() =>
				persistence.loadProject().pipe(Effect.flatMap(executor.loadProject), Effect.orDie),
			),
			Effect.forkScoped,
		);

		return Service.of(executor);
	}),
);

export * as ProjectExecution from "./ProjectExecution.ts";
