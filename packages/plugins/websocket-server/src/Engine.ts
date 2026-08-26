import {
	Cause,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	Result,
	Semaphore,
	Stream,
	SubscriptionRef,
} from "effect";

import {
	ClientConnected,
	ClientDisconnected,
	ClientId,
	ClientNotFound,
	ClientRpcs,
	InvalidServer,
	MAX_BUFFERED_BYTES,
	MAX_MESSAGE_BYTES,
	MAX_PENDING_MESSAGES,
	MessageReceived,
	MessageTooLarge,
	RuntimeRpcs,
	SendFailed,
	type ServerDefinition,
	ServerId,
	ServerNotFound,
	ServerNotRunning,
	ServerStartFailed,
	WebSocketServer,
	WebSocketServerEngine,
} from "./Definition.ts";
import { Adapter, ListenerError, type Client } from "./Listener.ts";

type Entry = {
	readonly definition: ServerDefinition;
	readonly generation: number;
	readonly status: "stopped" | "starting" | "running" | "error";
	readonly clients: ReadonlyMap<ClientId, Client>;
	readonly fiber?: Fiber.Fiber<void>;
	readonly error?: string;
};

const utf8Size = (input: string) => {
	let size = 0;
	for (let index = 0; index < input.length; index++) {
		const code = input.charCodeAt(index);
		if (code <= 0x7f) size++;
		else if (code <= 0x7ff) size += 2;
		else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			index + 1 < input.length &&
			input.charCodeAt(index + 1) >= 0xdc00 &&
			input.charCodeAt(index + 1) <= 0xdfff
		) {
			size += 4;
			index++;
		} else size += 3;
	}
	return size;
};

const wildcardHosts = new Set(["0.0.0.0", "::"]);
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const addressesOverlap = (left: ServerDefinition, right: ServerDefinition) =>
	left.port === right.port &&
	(left.host === right.host ||
		wildcardHosts.has(left.host) ||
		wildcardHosts.has(right.host) ||
		(loopbackHosts.has(left.host) && loopbackHosts.has(right.host)));

const isIpv4 = (host: string) => {
	const segments = host.split(".");
	return (
		segments.length === 4 &&
		segments.every(
			(segment) =>
				/^\d{1,3}$/.test(segment) &&
				(segment === "0" || !segment.startsWith("0")) &&
				Number(segment) <= 255,
		)
	);
};

const isIpv6 = (host: string) => {
	if (!/^[\da-f:]+$/i.test(host) || host.includes(":::")) return false;
	const halves = host.split("::");
	if (halves.length > 2) return false;
	const left = halves[0] === "" ? [] : halves[0]!.split(":");
	const right =
		halves.length === 1 || halves[1] === "" ? [] : halves[1]!.split(":");
	if (![...left, ...right].every((segment) => /^[\da-f]{1,4}$/i.test(segment)))
		return false;
	return halves.length === 2
		? left.length + right.length < 8
		: left.length === 8;
};

const isHostname = (host: string) =>
	host.length <= 253 &&
	!/^[\d.]+$/.test(host) &&
	host
		.split(".")
		.every(
			(label) =>
				label.length > 0 &&
				label.length <= 63 &&
				/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label),
		);

const normalizeHost = (input: string) => {
	const trimmed = input.trim().toLowerCase();
	return trimmed.startsWith("[") && trimmed.endsWith("]")
		? trimmed.slice(1, -1)
		: trimmed;
};

const failureReason = (cause: Cause.Cause<unknown>, fallback: string) => {
	const failure = Cause.findFail(cause);
	return Result.isSuccess(failure) &&
		typeof failure.success.error === "object" &&
		failure.success.error !== null &&
		"reason" in failure.success.error &&
		typeof failure.success.error.reason === "string"
		? failure.success.error.reason
		: fallback;
};

export const make = Effect.fnUntraced(function* (adapter: Adapter["Service"]) {
	const mg = yield* WebSocketServerEngine.EngineContext;
	const engineScope = yield* Effect.scope;
	const state = yield* SubscriptionRef.make<ReadonlyMap<ServerId, Entry>>(
		new Map(),
	);
	const lock = yield* Semaphore.make(1);

	yield* Stream.runForEach(
		SubscriptionRef.changes(state),
		() => mg.client.refresh,
	).pipe(Effect.forkScoped);

	const getEntry = (id: ServerId) =>
		SubscriptionRef.get(state).pipe(
			Effect.map((entries) => Option.fromNullishOr(entries.get(id))),
		);

	const updateEntry = (id: ServerId, update: (entry: Entry) => Entry) =>
		SubscriptionRef.update(state, (entries) => {
			const entry = entries.get(id);
			if (entry === undefined) return entries;
			const next = update(entry);
			return next === entry ? entries : new Map(entries).set(id, next);
		});

	const validate = Effect.fnUntraced(function* (
		definition: ServerDefinition,
		ignoredId?: ServerId,
	): Effect.fn.Return<ServerDefinition, InvalidServer> {
		const name = definition.name.trim();
		const host = normalizeHost(definition.host);
		if (name.length === 0 || name.length > 80)
			return yield* new InvalidServer({
				reason: "Name must contain 1 to 80 characters",
			});
		if (definition.id.length === 0 || definition.id.length > 128)
			return yield* new InvalidServer({
				reason: "Server ID must contain 1 to 128 characters",
			});
		if (
			!Number.isInteger(definition.port) ||
			definition.port < 1 ||
			definition.port > 65535
		)
			return yield* new InvalidServer({
				reason: "Port must be an integer from 1 to 65535",
			});
		if (
			host.length === 0 ||
			(!isIpv4(host) && !isIpv6(host) && !isHostname(host))
		)
			return yield* new InvalidServer({
				reason: "Host is not a valid bind address",
			});
		const normalized = { ...definition, name, host };
		const entries = yield* SubscriptionRef.get(state);
		if (
			[...entries.values()].some(
				(entry) =>
					entry.definition.id !== ignoredId &&
					addressesOverlap(entry.definition, normalized),
			)
		)
			return yield* new InvalidServer({
				reason: `Another server already uses ${normalized.host}:${normalized.port}`,
			});
		return normalized;
	});

	const save = SubscriptionRef.get(state).pipe(
		Effect.flatMap((entries) =>
			mg.storage.set({
				servers: [...entries.values()].map((entry) => entry.definition),
			}),
		),
	);

	const disconnectClients = Effect.fnUntraced(function* (
		entry: Entry,
		cause: "peer" | "server" | "error",
		reason: string,
	) {
		for (const clientId of entry.clients.keys()) {
			yield* mg.emit(
				new ClientDisconnected({
					serverId: entry.definition.id,
					clientId,
					cause,
					reason,
				}),
			);
		}
	});

	const stopUnsafe = Effect.fnUntraced(function* (id: ServerId) {
		const current = yield* getEntry(id);
		if (Option.isNone(current)) return yield* new ServerNotFound({ id });
		const entry = current.value;
		if (entry.status === "stopped" || entry.status === "error") return;
		yield* updateEntry(id, (latest) => ({
			definition: latest.definition,
			generation: latest.generation + 1,
			status: "stopped",
			clients: new Map(),
		}));
		yield* disconnectClients(entry, "server", "Server stopped").pipe(
			Effect.ensuring(
				entry.fiber === undefined ? Effect.void : Fiber.interrupt(entry.fiber),
			),
		);
	});

	const startUnsafe = Effect.fnUntraced(function* (id: ServerId) {
		return yield* Effect.uninterruptibleMask((restore) =>
			Effect.gen(function* () {
				const current = yield* getEntry(id);
				if (Option.isNone(current)) return yield* new ServerNotFound({ id });
				if (
					current.value.status === "running" ||
					current.value.status === "starting"
				)
					return;

				const definition = current.value.definition;
				const activeConflict = [
					...(yield* SubscriptionRef.get(state)).values(),
				].some(
					(entry) =>
						entry.definition.id !== id &&
						(entry.status === "starting" || entry.status === "running") &&
						addressesOverlap(entry.definition, definition),
				);
				if (activeConflict)
					return yield* new ServerStartFailed({
						id,
						reason: `Another listener already owns ${definition.host}:${definition.port}`,
					});

				const generation = current.value.generation + 1;
				const ready = yield* Deferred.make<void, ListenerError>();
				yield* updateEntry(id, (entry) => ({
					definition: entry.definition,
					generation,
					status: "starting",
					clients: new Map(),
				}));

				const onClient = (client: Client) =>
					Effect.uninterruptibleMask((restoreClient) =>
						Effect.gen(function* () {
							const registered = yield* Effect.gen(function* () {
								const candidate = yield* SubscriptionRef.modify(
									state,
									(entries) => {
										const entry = entries.get(id);
										if (
											entry === undefined ||
											entry.generation !== generation ||
											entry.status !== "running"
										)
											return [Option.none<ClientId>(), entries];
										let clientId = ClientId.make(
											globalThis.crypto.randomUUID(),
										);
										while (
											[...entries.values()].some((candidate) =>
												candidate.clients.has(clientId),
											)
										)
											clientId = ClientId.make(globalThis.crypto.randomUUID());
										return [
											Option.some(clientId),
											new Map(entries).set(id, {
												...entry,
												clients: new Map(entry.clients).set(clientId, client),
											}),
										];
									},
								);
								if (Option.isNone(candidate)) return candidate;
								const emitted = yield* Effect.exit(
									restoreClient(
										mg.emit(
											new ClientConnected({
												serverId: id,
												clientId: candidate.value,
											}),
										),
									),
								);
								if (Exit.isSuccess(emitted)) return candidate;
								yield* updateEntry(id, (entry) => {
									if (
										entry.generation !== generation ||
										!entry.clients.has(candidate.value)
									)
										return entry;
									const clients = new Map(entry.clients);
									clients.delete(candidate.value);
									return { ...entry, clients };
								});
								return Option.none<ClientId>();
							}).pipe(lock.withPermit);
							if (Option.isNone(registered)) return;
							const clientId = registered.value;
							const clientExit = yield* Effect.exit(
								restoreClient(
									client.run((message) =>
										Effect.gen(function* () {
											if (
												typeof message !== "string" ||
												!message.isWellFormed()
											)
												return;
											const latest = yield* getEntry(id);
											if (
												Option.isNone(latest) ||
												latest.value.generation !== generation ||
												!latest.value.clients.has(clientId)
											)
												return;
											const size = utf8Size(message);
											if (size > MAX_MESSAGE_BYTES) return;
											yield* mg.emit(
												new MessageReceived({
													serverId: id,
													clientId,
													message,
												}),
											);
										}),
									),
								),
							);
							const disconnected = Exit.isFailure(clientExit)
								? {
										cause: "error" as const,
										reason: Cause.hasInterrupts(clientExit.cause)
											? "Client handling was interrupted"
											: failureReason(
													clientExit.cause,
													"WebSocket peer failed",
												),
									}
								: { cause: "peer" as const, reason: "Peer disconnected" };
							const removed = yield* SubscriptionRef.modify(
								state,
								(entries) => {
									const entry = entries.get(id);
									if (
										entry === undefined ||
										entry.generation !== generation ||
										!entry.clients.has(clientId)
									)
										return [false, entries];
									const clients = new Map(entry.clients);
									clients.delete(clientId);
									return [
										true,
										new Map(entries).set(id, { ...entry, clients }),
									];
								},
							);
							if (removed)
								yield* mg.emit(
									new ClientDisconnected({
										serverId: id,
										clientId,
										...disconnected,
									}),
								);
						}),
					);

				const lifecycle = Effect.scoped(
					Effect.gen(function* () {
						const listener = yield* adapter.listen({
							host: definition.host,
							port: definition.port,
							maxMessageBytes: MAX_MESSAGE_BYTES,
							maxBufferedBytes: MAX_BUFFERED_BYTES,
							maxPendingMessages: MAX_PENDING_MESSAGES,
						});
						yield* Deferred.succeed(ready, undefined);
						return yield* listener.run(onClient);
					}),
				).pipe(
					Effect.tapError((error) => Deferred.fail(ready, error)),
					Effect.exit,
					Effect.flatMap((exit) => {
						const reason = Exit.isFailure(exit)
							? failureReason(
									exit.cause,
									"WebSocket listener stopped unexpectedly",
								)
							: "WebSocket listener completed unexpectedly";
						return SubscriptionRef.modify(state, (entries) => {
							const entry = entries.get(id);
							if (
								entry === undefined ||
								entry.generation !== generation ||
								(entry.status !== "starting" && entry.status !== "running")
							)
								return [Option.none<Entry>(), entries];
							return [
								Option.some(entry),
								new Map(entries).set(id, {
									definition: entry.definition,
									generation: generation + 1,
									status: "error",
									clients: new Map(),
									error: reason,
								}),
							];
						}).pipe(
							Effect.flatMap((entry) =>
								Option.isNone(entry)
									? Effect.void
									: disconnectClients(entry.value, "error", reason),
							),
						);
					}),
				);
				const fiber = yield* lifecycle.pipe(Effect.forkIn(engineScope));
				yield* updateEntry(id, (entry) =>
					entry.generation !== generation ? entry : { ...entry, fiber },
				);
				const cleanupInterruptedStart = updateEntry(id, (entry) =>
					entry.generation !== generation
						? entry
						: {
								definition: entry.definition,
								generation: generation + 1,
								status: "stopped",
								clients: new Map(),
							},
				).pipe(Effect.andThen(Fiber.interrupt(fiber)));
				const listened = yield* Effect.result(
					restore(Deferred.await(ready)).pipe(
						Effect.onInterrupt(() => cleanupInterruptedStart),
					),
				);
				if (Result.isFailure(listened)) {
					yield* updateEntry(id, (entry) =>
						entry.generation !== generation
							? entry
							: {
									definition: entry.definition,
									generation,
									status: "error",
									clients: new Map(),
									error: listened.failure.reason,
								},
					);
					return yield* new ServerStartFailed({
						id,
						reason: listened.failure.reason,
					});
				}
				yield* updateEntry(id, (entry) =>
					entry.generation !== generation
						? entry
						: { ...entry, status: "running" },
				);
			}),
		);
	});

	const stored = yield* mg.storage.get;
	for (const definition of stored.servers) {
		const validated = yield* Effect.result(validate(definition));
		const entry: Entry = Result.isSuccess(validated)
			? {
					definition: validated.success,
					generation: 0,
					status: "stopped",
					clients: new Map(),
				}
			: {
					definition,
					generation: 0,
					status: "error",
					clients: new Map(),
					error: validated.failure.reason,
				};
		yield* SubscriptionRef.update(state, (entries) =>
			new Map(entries).set(definition.id, entry),
		);
	}

	for (const entry of (yield* SubscriptionRef.get(state)).values()) {
		if (!entry.definition.manuallyDisabled && entry.status === "stopped")
			yield* startUnsafe(entry.definition.id).pipe(
				Effect.catchCause((cause) =>
					Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.void,
				),
			);
	}

	yield* Effect.addFinalizer(() =>
		Effect.forEach(
			[...SubscriptionRef.getUnsafe(state).keys()],
			(id) => stopUnsafe(id).pipe(Effect.catchCause(() => Effect.void)),
			{ discard: true },
		),
	);

	const publicState = (entry: Entry) => ({
		definition: entry.definition,
		status: entry.status,
		clientCount: entry.clients.size,
		...(entry.error === undefined ? {} : { error: entry.error }),
	});

	const checkedMessage = Effect.fnUntraced(function* (
		serverId: ServerId,
		message: string,
	) {
		const size = utf8Size(message);
		if (!message.isWellFormed())
			return yield* new SendFailed({
				serverId,
				reason: "Message is not well-formed Unicode text",
			});
		if (size > MAX_MESSAGE_BYTES)
			return yield* new MessageTooLarge({ size, limit: MAX_MESSAGE_BYTES });
	});

	const send = (serverId: ServerId, client: Client, message: string) =>
		Effect.raceFirst(
			client.send(message).pipe(
				Effect.timeoutOrElse({
					duration: "5 seconds",
					orElse: () =>
						Effect.fail(
							new SendFailed({ serverId, reason: "WebSocket send timed out" }),
						),
				}),
				Effect.catchCause((cause) =>
					Cause.hasInterrupts(cause)
						? Effect.interrupt
						: Effect.fail(
								new SendFailed({
									serverId,
									reason: failureReason(cause, "WebSocket send failed"),
								}),
							),
				),
			),
			client.closed.pipe(
				Effect.andThen(
					Effect.fail(
						new SendFailed({
							serverId,
							reason: "The WebSocket peer closed before the message was sent",
						}),
					),
				),
			),
		);

	return WebSocketServerEngine.of({
		resources: WebSocketServer.toLayer(
			SubscriptionRef.get(state).pipe(
				Effect.map((entries) =>
					[...entries.values()].map((entry) => ({
						id: entry.definition.id,
						display: entry.definition.name,
					})),
				),
			),
		),
		rpcs: RuntimeRpcs.toLayer({
			WebSocketServerSendToClient: ({ serverId, clientId, message }) =>
				Effect.gen(function* () {
					yield* checkedMessage(serverId, message);
					const current = yield* getEntry(serverId);
					if (Option.isNone(current))
						return yield* new ServerNotFound({ id: serverId });
					if (current.value.status !== "running")
						return yield* new ServerNotRunning({ id: serverId });
					const client = current.value.clients.get(clientId);
					if (client === undefined)
						return yield* new ClientNotFound({ serverId, clientId });
					yield* send(serverId, client, message);
				}),
			WebSocketServerBroadcast: ({ serverId, message }) =>
				Effect.gen(function* () {
					yield* checkedMessage(serverId, message);
					const current = yield* getEntry(serverId);
					if (Option.isNone(current))
						return yield* new ServerNotFound({ id: serverId });
					if (current.value.status !== "running")
						return yield* new ServerNotRunning({ id: serverId });
					yield* Effect.forEach(
						current.value.clients.values(),
						(client) => send(serverId, client, message),
						{ concurrency: 16, discard: true },
					);
				}),
		}),
		client: {
			state: SubscriptionRef.get(state).pipe(
				Effect.map((entries) => ({
					servers: [...entries.values()].map(publicState),
				})),
			),
			rpcs: ClientRpcs.toLayer({
				WebSocketServerAdd: (input) =>
					Effect.gen(function* () {
						const id = ServerId.make(globalThis.crypto.randomUUID());
						const definition = yield* validate({
							...input,
							id,
							manuallyDisabled: false,
						});
						yield* SubscriptionRef.update(state, (entries) =>
							new Map(entries).set(id, {
								definition,
								generation: 0,
								status: "stopped",
								clients: new Map(),
							}),
						);
						yield* save;
						yield* mg.resource.refresh(WebSocketServer);
						return id;
					}).pipe(lock.withPermit),
				WebSocketServerUpdate: (input) =>
					Effect.gen(function* () {
						const current = yield* getEntry(input.id);
						if (Option.isNone(current))
							return yield* new ServerNotFound({ id: input.id });
						const definition = yield* validate(input, input.id);
						yield* stopUnsafe(input.id);
						yield* updateEntry(input.id, (entry) => ({
							definition,
							generation: entry.generation + 1,
							status: "stopped",
							clients: new Map(),
						}));
						yield* save;
						yield* mg.resource.refresh(WebSocketServer);
					}).pipe(lock.withPermit),
				WebSocketServerRemove: ({ id }) =>
					Effect.gen(function* () {
						const current = yield* getEntry(id);
						if (Option.isNone(current))
							return yield* new ServerNotFound({ id });
						yield* stopUnsafe(id);
						yield* SubscriptionRef.update(state, (entries) => {
							const next = new Map(entries);
							next.delete(id);
							return next;
						});
						yield* save;
						yield* mg.resource.refresh(WebSocketServer);
					}).pipe(lock.withPermit),
				WebSocketServerStart: ({ id }) =>
					Effect.gen(function* () {
						const current = yield* getEntry(id);
						if (Option.isNone(current))
							return yield* new ServerNotFound({ id });
						yield* updateEntry(id, (entry) => ({
							...entry,
							definition: {
								...entry.definition,
								manuallyDisabled: false,
							},
						}));
						yield* save;
						yield* startUnsafe(id);
					}).pipe(lock.withPermit),
				WebSocketServerStop: ({ id }) =>
					Effect.gen(function* () {
						const current = yield* getEntry(id);
						if (Option.isNone(current))
							return yield* new ServerNotFound({ id });
						yield* updateEntry(id, (entry) => ({
							...entry,
							definition: {
								...entry.definition,
								manuallyDisabled: true,
							},
						}));
						yield* save;
						yield* stopUnsafe(id);
					}).pipe(lock.withPermit),
				WebSocketServerStatus: ({ id }) =>
					getEntry(id).pipe(
						Effect.flatMap((entry) =>
							Option.isNone(entry)
								? Effect.fail(new ServerNotFound({ id }))
								: Effect.succeed(publicState(entry.value)),
						),
					),
			}),
		},
	});
});

export const layer = Layer.effect(WebSocketServerEngine)(
	Effect.flatMap(Adapter, make),
);
export const localLayer = (adapter: Layer.Layer<Adapter>) =>
	layer.pipe(Layer.provide(adapter));
