import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { Layer } from "effect";
import * as Effect from "effect/Effect";

import { DrizzleMigrationBundle } from "./src/DrizzleMigrationBundle.ts";
import MainWorker from "./src/MainWorker.ts";

export default Alchemy.Stack(
	"Cloudflare",
	{
		providers: Layer.mergeAll(
			Cloudflare.providers(),
			Drizzle.providers(),
			DrizzleMigrationBundle.providers(),
		),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const worker = yield* MainWorker;

		return {
			worker: worker.url,
		};
	}),
);
