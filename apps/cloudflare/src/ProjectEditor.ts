import { Project, defaultPackage } from "@macrograph/core";
import { Editor, EditorRpc, Packages, ProjectPubSub } from "@macrograph/editor";
import { Persistence } from "@macrograph/persistence";
import { SqlitePersistence } from "@macrograph/persistence-sqlite";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Alchemy from "alchemy";
import * as Drizzle from "alchemy/Drizzle";
import { Layer, Queue, Scope } from "effect";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { Rpc, RpcGroup, RpcMessage, RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { DrizzleMigrationBundle } from "./DrizzleMigrationBundle.ts";
import { DurableSqlitePersistence } from "./DurableSqlitePersistence.ts";

const sqliteSchemaPath = "../../packages/persistence-sqlite/src/schema.ts";

export default class ProjectEditor extends Cloudflare.DurableObjectNamespace<ProjectEditor>()(
	"ProjectEditor",
	Effect.gen(function* () {
		const sqliteSchema = yield* Drizzle.Schema("ProjectEditorSqliteSchema", {
			schema: sqliteSchemaPath,
			dialect: "sqlite",
			out: "../../packages/persistence-sqlite/drizzle"
		});
		const migrations = yield* DrizzleMigrationBundle.bindBundle("ProjectEditorSqliteMigrations", {
			migrationsDir: sqliteSchema.out,
		});

		const PackagesLayer = Layer.effect(
			Packages.Service,
			Effect.gen(function* () {
				const packages = yield* Packages.Service;
				yield* packages.loadPackage(defaultPackage);
				return packages;
			}),
		).pipe(Layer.provide(Packages.defaultLayer));

		const AppLayer = Editor.defaultLayer
			.pipe(Layer.provideMerge(PackagesLayer))
			.pipe(Layer.provideMerge(ProjectPubSub.defaultLayer))
			.pipe(Layer.provideMerge(SqlitePersistence.layer.pipe(Layer.provide(Layer.unwrap(Effect.map(migrations, DurableSqlitePersistence.layer))))));

		return Effect.gen(function* () {
			const persistence = yield* Persistence.Service;

			yield* persistence
				.saveProject(
					new Project.Model({
						name: "test",
						graphs: {},
					}),
				)
				.pipe(Effect.orDie);

			const RpcLayer = Layer.mergeAll(
				RpcSerialization.layerJsonRpc(),
				EditorRpc.handlerLayer,
			)

			const rpcWs = yield* makeRpcServerHttpEffectWebsocket(
				EditorRpc.EditorRpcs,
			).pipe(Effect.provide(RpcLayer));

			const rpcHttp = yield* RpcServer.toHttpEffect(EditorRpc.EditorRpcs).pipe(Effect.provide(RpcLayer))

			const fetch = Layer.mergeAll(
				HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.text("Hello world!"))),
				HttpRouter.add("GET", "/rpc-ws", rpcWs.httpEffect),
				HttpRouter.add("*", "/rpc", rpcHttp),
			).pipe(HttpRouter.toHttpEffect);

			return {
				fetch,
				...rpcWs.handlers,
			};
		}).pipe(
			Effect.provide(AppLayer),
		);
	}),
) { }

type SocketAttachment = {
	uuid: string;
};

export const makeRpcServerHttpEffectWebsocket
	// 	: <Rpcs extends Rpc.Any>(
	// 	group: RpcGroup.RpcGroup<Rpcs>,
	// 	options?:
	// 		| {
	// 			readonly disableTracing?: boolean | undefined;
	// 			readonly spanPrefix?: string | undefined;
	// 			readonly spanAttributes?: Record<string, unknown> | undefined;
	// 			readonly disableFatalDefects?: boolean | undefined;
	// 		}
	// 		| undefined,
	// ) => Effect.Effect<
	// 	{
	// 		httpEffect: Effect.Effect<
	// 			HttpServerResponse.HttpServerResponse,
	// 			never,
	// 			Scope.Scope | Cloudflare.DurableObjectState
	// 		>;
	// 		handlers: Cloudflare.DurableObjectShape
	// 	},
	// 	never,
	// 	| Scope.Scope
	// 	| RpcSerialization.RpcSerialization
	// 	| Rpc.ToHandler<Rpcs>
	// 	| Rpc.Middleware<Rpcs>
	// 	| Rpc.ServicesServer<Rpcs>
	// 	| Cloudflare.DurableObjectState
	// 	| Alchemy.RuntimeContext
	// 	>
	= Effect.fnUntraced(function* <Rpcs extends Rpc.Any>(
		group: RpcGroup.RpcGroup<Rpcs>,
		options?: {
			readonly disableTracing?: boolean | undefined;
			readonly spanPrefix?: string | undefined;
			readonly spanAttributes?: Record<string, unknown> | undefined;
			readonly disableFatalDefects?: boolean | undefined;
		},
	) {
		const { onSocket, protocol, handlers } = yield* Effect.gen(function* () {
			const state = yield* Cloudflare.DurableObjectState;

			const serialization = yield* RpcSerialization.RpcSerialization;
			const disconnects = yield* Queue.make<number>();

			let clientId = 0;
			const clients = new Map<
				number,
				{
					readonly write: (bytes: RpcMessage.FromServerEncoded) => Effect.Effect<void>;
					readonly webSocketMessage: (message: string | ArrayBuffer) => Effect.Effect<void>;
					readonly webSocketClose: (code: number, reason: string) => Effect.Effect<void>;
				}
			>();
			const uuidToId = new Map<string, number>();
			const clientIds = new Set<number>();
			const sessions = new Map<string, Cloudflare.DurableWebSocket>();

			const onSocket = Effect.fnUntraced(function* (
				socket: Cloudflare.DurableWebSocket,
				uuid?: string,
			) {
				const id = clientId++;
				let _uuid = uuid;

				if (!_uuid) {
					_uuid = crypto.randomUUID();
					socket.serializeAttachment<SocketAttachment>({ uuid: _uuid });
				}

				uuidToId.set(_uuid, id);
				sessions.set(_uuid, socket);

				const parser = serialization.makeUnsafe();

				const writeRaw = socket.send;
				const write = (response: RpcMessage.FromServerEncoded) => {
					try {
						const encoded = parser.encode(response);
						if (encoded === undefined) {
							return Effect.void;
						}
						return Effect.orDie(writeRaw(encoded));
					} catch (cause) {
						return Effect.orDie(writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!));
					}
				};
				clients.set(id, {
					write,
					webSocketClose: () => Effect.void,
					webSocketMessage: (data) => {
						try {
							const decoded = parser.decode(
								typeof data === "string" ? data : new Uint8Array(data),
							) as ReadonlyArray<RpcMessage.FromClientEncoded>;
							if (decoded.length === 0) return Effect.void;
							let i = 0;
							return Effect.whileLoop({
								while: () => i < decoded.length,
								body() {
									const message = decoded[i++];
									// if (message._tag === "Request" && headers) {
									// 	; (message as Types.Mutable<RpcMessage.RequestEncoded>).headers = headers.concat(message.headers)
									// }
									return writeRequest(id, message);
								},
								step: constVoid,
							});
						} catch (cause) {
							return writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!);
						}
					},
				});
				clientIds.add(id);
			});

			for (const socket of yield* state.getWebSockets()) {
				const data = socket.deserializeAttachment<SocketAttachment>();
				console.log("restoring socket", data);
				if (data) yield* onSocket(socket, data.uuid);
			}

			let writeRequest!: (
				clientId: number,
				message: RpcMessage.FromClientEncoded,
			) => Effect.Effect<void>;

			const protocol = yield* RpcServer.Protocol.make((writeRequest_) => {
				writeRequest = writeRequest_;
				return Effect.succeed({
					disconnects,
					send: (clientId, response) => {
						const client = clients.get(clientId);
						if (!client) return Effect.void;
						return Effect.orDie(client.write(response));
					},
					end(_clientId) {
						return Effect.void;
					},
					clientIds: Effect.sync(() => clientIds),
					initialMessage: Effect.succeedNone,
					supportsAck: true,
					supportsTransferables: false,
					supportsSpanPropagation: true,
				});
			});

			return {
				protocol,
				onSocket,
				handlers: {
					webSocketMessage: (
						socket: Cloudflare.DurableWebSocket,
						message: string | ArrayBuffer,
					): Effect.Effect<boolean> => {
						const attachment = socket.deserializeAttachment<SocketAttachment>();
						if (!attachment) return Effect.succeed(false);

						const client = clients.get(uuidToId.get(attachment.uuid)!);
						if (!client) return Effect.succeed(false);

						return client.webSocketMessage(message).pipe(Effect.as(true));
					},
					webSocketClose: (
						socket: Cloudflare.DurableWebSocket,
						code: number,
						reason: string,
					): Effect.Effect<boolean> => {
						const attachment = socket.deserializeAttachment<SocketAttachment>();
						if (!attachment) return Effect.succeed(false);

						const client = clients.get(uuidToId.get(attachment.uuid)!);
						if (!client) return Effect.succeed(false);

						return client.webSocketClose(code, reason).pipe(Effect.as(true));
					},
				},
			} as const;
		});

		const httpEffect = Effect.gen(function* () {
			const [response, socket] = yield* Cloudflare.upgrade();

			yield* onSocket(socket);

			return response;
		});

		yield* RpcServer.make(group, options).pipe(
			Effect.provideService(RpcServer.Protocol, protocol),
			Effect.forkDetach,
		);

		return { httpEffect, handlers };
	});
