import { assert, it } from "@effect/vitest";
import { Engine, HttpEndpoint, HttpIngress, Plugin } from "@macrograph/plugin";
import { Effect, Option, Redacted, Schema } from "effect";

import { HttpIngressRuntime } from "../src/HttpIngressRuntime.ts";

const TestEvent = Schema.TaggedStruct("Received", { value: Schema.String });
const TestStorage = Schema.Struct({ values: Schema.Array(Schema.String) });
class TestEngine extends Engine.make({
	events: [TestEvent.make({ value: "" })],
	storage: TestStorage,
	initialStorage: { values: [] },
}) {}
const TestPlugin = Plugin.make({
	id: "test",
	engine: TestEngine,
	effect: () => Effect.void,
});

const TestIngress = HttpIngress.make({
	id: "test:received",
	pluginId: "test",
	displayName: "Webhook",
	method: "POST",
	metadata: Schema.Struct({ value: Schema.String }),
	configuration: Schema.Struct({
		token: Schema.String,
		topics: Schema.Array(Schema.String),
	}),
	event: TestEvent,
	mergeConfiguration: (current, next) => ({
		token: current.token,
		topics: [...new Set([...current.topics, ...next.topics])],
	}),
	accepts: (configuration, eventType) =>
		configuration.topics.includes(eventType),
});

it.effect(
	"resolves, mounts, dispatches, and removes HTTP ingress handlers",
	() =>
		Effect.gen(function* () {
			const operations: Array<string> = [];
			const live = TestIngress.implement(
				Effect.succeed(
					Effect.succeed({
						mount: ({ endpoint }) =>
							Effect.sync(() => {
								operations.push(`mount:${endpoint.instanceKey}`);
							}),
						handle: (request) =>
							Effect.succeed(
								request.configuration.token === "token"
									? {
											status: 200,
											events: [
												{
													event: TestEvent.make({
														value: request.endpoint.metadata.value,
													}),
												},
											],
										}
									: { status: 403 },
							),
					}),
				),
			);
			const deployment = Engine.withHttpIngress(
				Engine.deployment(
					TestPlugin,
					TestEngine.toLayer(() => Effect.die("Test engine is not hosted")),
				),
				{
					handlers: [live],
					requirements: (state) =>
						Effect.succeed(
							state.values.map((value) =>
								TestIngress.require({
									instanceKey: value,
									displayName: `Endpoint ${value}`,
									metadata: { value },
									configuration: { token: "token", topics: ["Received"] },
								}),
							),
						),
				},
			);
			const registry = yield* HttpIngress.makeRegistry(
				deployment.httpIngress.handlers,
			);
			const provisioned = new Map<string, HttpEndpoint.Routed>();
			const endpoints = HttpEndpoint.Host.of({
				ensure: (handler, endpoint) => {
					const resolved = {
						id: HttpEndpoint.Id.make(endpoint.instanceKey),
						url: `https://example.com/${endpoint.instanceKey}`,
						schema: { id: handler.id, displayName: handler.displayName },
						instanceKey: HttpEndpoint.InstanceKey.make(endpoint.instanceKey),
						...(endpoint.displayName === undefined
							? {}
							: { displayName: endpoint.displayName }),
						metadata: endpoint.metadata,
					};
					provisioned.set(endpoint.instanceKey, resolved);
					return Effect.succeed(resolved);
				},
				get: (handler, instanceKey) => {
					const existing = provisioned.get(instanceKey);
					if (existing === undefined) return Effect.succeedNone;
					return Schema.decodeUnknownEffect(handler.metadata)(
						existing.metadata,
					).pipe(
						Effect.map((metadata) => Option.some({ ...existing, metadata })),
						Effect.mapError(
							(cause) => new HttpEndpoint.ProvisionError({ cause }),
						),
					);
				},
				remove: (_handler, instanceKey) =>
					Effect.sync(() => {
						operations.push(`remove:${instanceKey}`);
						provisioned.delete(instanceKey);
					}),
				lookup: () => Effect.succeed(Option.none()),
				secret: () => Effect.succeed(Redacted.make("test-secret")),
			});
			const runtime = yield* HttpIngressRuntime.make(
				[deployment],
				registry,
				endpoints,
			);
			const manifest = yield* runtime.resolveManifest({
				test: { values: ["one", "two"] },
			});
			const mounted = yield* runtime.reconcile([], manifest);
			assert.deepStrictEqual(
				mounted.map((endpoint) => endpoint.url),
				["https://example.com/one", "https://example.com/two"],
			);
			assert.deepStrictEqual(mounted[0]?.schema, {
				id: TestIngress.id,
				displayName: "Webhook",
			});
			assert.strictEqual(mounted[0]?.displayName, "Endpoint one");
			assert.deepStrictEqual(operations, ["mount:one", "mount:two"]);

			const unchanged = yield* runtime.reconcile(manifest, manifest);
			assert.deepStrictEqual(
				unchanged.map((endpoint) => endpoint.url),
				["https://example.com/one", "https://example.com/two"],
			);
			assert.deepStrictEqual(operations, ["mount:one", "mount:two"]);

			const refreshed = yield* runtime.reconcile(manifest, manifest, {
				remount: true,
			});
			assert.deepStrictEqual(
				refreshed.map((endpoint) => endpoint.url),
				["https://example.com/one", "https://example.com/two"],
			);
			assert.deepStrictEqual(operations, [
				"mount:one",
				"mount:two",
				"mount:one",
				"mount:two",
			]);

			const renamed = manifest.map((entry) =>
				entry.instanceKey === HttpEndpoint.InstanceKey.make("one")
					? { ...entry, displayName: "Renamed endpoint" }
					: entry,
			);
			const remounted = yield* runtime.reconcile(manifest, renamed);
			assert.strictEqual(remounted[0]?.displayName, "Renamed endpoint");
			assert.deepStrictEqual(operations, [
				"mount:one",
				"mount:two",
				"mount:one",
				"mount:two",
				"mount:one",
			]);

			const response = yield* runtime.handle({
				endpoint: mounted[0]!,
				configuration: manifest[0]!.configuration,
				method: "POST",
				headers: {},
				body: new Uint8Array(),
			});
			assert.strictEqual(response.events[0]?.eventType, "Received");

			const preview = manifest.map((entry) => ({
				...entry,
				configuration: { token: "preview-token", topics: ["PreviewOnly"] },
			}));
			const provider = yield* runtime.mergeManifests([manifest, preview]);
			assert.deepStrictEqual(provider[0]?.configuration, {
				token: "token",
				topics: ["Received", "PreviewOnly"],
			});
			assert.isTrue(yield* runtime.allows(manifest[0]!, response.events[0]!));
			assert.isFalse(yield* runtime.allows(preview[0]!, response.events[0]!));

			yield* runtime.reconcile(renamed, []);
			assert.deepStrictEqual(operations, [
				"mount:one",
				"mount:two",
				"mount:one",
				"mount:two",
				"mount:one",
				"remove:one",
				"remove:two",
			]);
		}),
);
