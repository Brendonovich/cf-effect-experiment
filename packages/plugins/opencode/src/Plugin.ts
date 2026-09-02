import { DataType, Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import {
	OpenCodeConnection,
	OpenCodeEngine,
	OpenCodeModel,
} from "./Definition.ts";

const properties = {
	connection: { name: "OpenCode Server", resource: OpenCodeConnection },
} as const;

export default Plugin.make({
	id: "opencode",
	name: "OpenCode",
	engine: OpenCodeEngine,
	effect: Effect.fnUntraced(function* (context) {
		yield* context.schema.register({
			id: "CreateSession",
			name: "Create Session",
			description:
				"Creates an OpenCode session and optionally queues an initial prompt. Blank directory uses the server location; Automatic model uses its default.",
			properties: {
				...properties,
				model: { name: "Model", resource: OpenCodeModel },
			},
			io: (io) => ({
				text: io.data.in("text", DataType.String, {
					name: "Prompt",
					defaultValue: "",
				}),
				directory: io.data.in("directory", DataType.String, {
					name: "Directory",
					defaultValue: "",
				}),
				title: io.data.in("title", DataType.String, {
					name: "Title",
					defaultValue: "",
				}),
				sessionID: io.data.out("sessionID", DataType.String, {
					name: "Session ID",
				}),
			}),
			run: ({ io, engine, properties }) =>
				engine
					.OpenCodeCreateSession({
						connection: properties.connection,
						directory: io.directory,
						title: io.title,
						model: properties.model,
					})
					.pipe(
						Effect.tap((id) =>
							io.text.trim() === ""
								? Effect.void
								: engine.OpenCodePromptSession({
										connection: properties.connection,
										sessionID: id,
										text: io.text,
										model: "",
									}),
						),
						Effect.tap((id) => Effect.sync(() => io.sessionID(id))),
						Effect.asVoid,
					),
		});
		yield* context.schema.register({
			id: "PromptSession",
			name: "Prompt Session",
			description:
				"Queues a prompt and returns its inbox ID. Automatic model preserves the session model. Permissions and questions are handled in OpenCode.",
			properties: {
				...properties,
				model: { name: "Model", resource: OpenCodeModel },
			},
			io: (io) => ({
				sessionID: io.data.in("sessionID", DataType.String, {
					name: "Session ID",
					defaultValue: "",
					suggestions: ({ properties, engine }) =>
						engine
							.OpenCodeSessions({ connection: properties.connection })
							.pipe(
								Effect.map((sessions) => sessions.map((session) => session.id)),
							),
				}),
				text: io.data.in("text", DataType.String, { name: "Prompt" }),
				inboxID: io.data.out("inboxID", DataType.String, { name: "Inbox ID" }),
			}),
			run: ({ io, engine, properties }) =>
				engine
					.OpenCodePromptSession({
						connection: properties.connection,
						sessionID: io.sessionID,
						text: io.text,
						model: properties.model,
					})
					.pipe(
						Effect.tap((id) => Effect.sync(() => io.inboxID(id))),
						Effect.asVoid,
					),
		});
		yield* context.schema.register({
			id: "WaitForSession",
			name: "Wait For Session",
			description:
				"Waits up to 30 minutes for an OpenCode session to become idle. Cancelling the graph does not interrupt the remote session.",
			properties,
			io: (io) => ({
				sessionID: io.data.in("sessionID", DataType.String, {
					name: "Session ID",
				}),
			}),
			run: ({ io, engine, properties }) =>
				engine.OpenCodeWaitForSession({
					connection: properties.connection,
					sessionID: io.sessionID,
				}),
		});
	}),
});
