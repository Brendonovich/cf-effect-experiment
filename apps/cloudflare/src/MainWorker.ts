import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpMiddleware, HttpServerRequest } from "effect/unstable/http";

import ProjectEditor from "./ProjectEditor.ts";

export default Cloudflare.Worker(
	"MainWorker",
	{
		main: import.meta.url,
	},
	Effect.gen(function* () {
		const projectEditors = yield* ProjectEditor;

		return {
			fetch: Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest;

				const projectEditor = projectEditors.getByName("test");
				const response = projectEditor.fetch(request);

				if (request.headers.upgrade?.toLowerCase() === "websocket") {
					return yield* response;
				}

				return yield* response.pipe(HttpMiddleware.cors());
			}),
		};
	}),
);
