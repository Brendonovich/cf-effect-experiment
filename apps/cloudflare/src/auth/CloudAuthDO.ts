import {
	CloudCredentials,
	SessionStoreError,
	type CredentialClient,
} from "@macrograph/cloud-credentials";
import { type Engine } from "@macrograph/plugin";
import { RuntimeContext as AlchemyRuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Redacted } from "effect";

const stateKey = "macrograph-auth-v2";

export type Status =
	| { readonly state: "disconnected" }
	| { readonly state: "pending"; readonly verificationUrl: string }
	| {
			readonly state: "connected";
			readonly userId: string;
			readonly email: string;
	  };

export interface CredentialTransfer {
	readonly id: string;
	readonly provider: string;
	readonly displayName?: string | null;
	readonly clientId?: string;
	readonly token: { readonly access: string };
}

const transferCredential = (
	credential: Engine.Credential,
): CredentialTransfer => ({
	id: credential.id,
	provider: credential.provider,
	...(credential.displayName === undefined
		? {}
		: { displayName: credential.displayName }),
	...(credential.clientId === undefined
		? {}
		: { clientId: credential.clientId }),
	token: { access: Redacted.value(credential.token.access) },
});

/**
 * Owns authorization per session. The DO shares one credential cache and lock
 * across callers; stateless Workers would need distributed coordination for
 * authorization changes and credential refreshes, not just database storage.
 */
export default class CloudAuthDO extends Cloudflare.DurableObject<CloudAuthDO>()(
	"CloudAuthDO",
	Effect.gen(function* () {
		const durableState = yield* Cloudflare.DurableObjectState;
		return Effect.gen(function* () {
			const runtimeContext = yield* Effect.context<AlchemyRuntimeContext>();
			const storageFailure = () =>
				new SessionStoreError({
					reason: "MacroGraph authorization storage is unavailable",
				});
			const store: CloudCredentials.SessionStore = {
				read: durableState.storage.get<string>(stateKey).pipe(
					Effect.provide(runtimeContext),
					Effect.map((value) => value ?? null),
					Effect.catchCause(() => Effect.fail(storageFailure())),
				),
				write: (value) =>
					durableState.storage.put(stateKey, value).pipe(
						Effect.provide(runtimeContext),
						Effect.catchCause(() => Effect.fail(storageFailure())),
					),
				clear: durableState.storage.delete(stateKey).pipe(
					Effect.provide(runtimeContext),
					Effect.asVoid,
					Effect.catchCause(() => Effect.fail(storageFailure())),
				),
			};
			const client: CredentialClient = CloudCredentials.make({
				store,
			}).credentials;
			const toStatus = (
				status: Effect.Success<typeof client.auth.status>,
			): Status =>
				status.state === "connected"
					? {
							state: "connected",
							userId: status.identity.id,
							email: status.identity.displayName,
						}
					: status;

			const status = () =>
				client.auth.status.pipe(Effect.map(toStatus), Effect.orDie);
			const start = () =>
				client.auth.start.pipe(Effect.map(toStatus), Effect.orDie);
			const poll = () =>
				client.auth.poll.pipe(Effect.map(toStatus), Effect.orDie);
			const disconnect = () => client.auth.disconnect.pipe(Effect.orDie);
			const userId = () =>
				status().pipe(
					Effect.map((current) =>
						current.state === "connected" ? current.userId : undefined,
					),
				);
			const getCredentials = () =>
				client.get.pipe(Effect.map((values) => values.map(transferCredential)));
			const refreshCredential = (provider: string, id: string) =>
				client.refresh(provider, id).pipe(Effect.map(transferCredential));
			const credentialCatalog = () => client.catalog;
			const refetchCredentials = () => client.refetch;

			return {
				status,
				start,
				poll,
				disconnect,
				userId,
				getCredentials,
				refreshCredential,
				credentialCatalog,
				refetchCredentials,
			};
		});
	}),
) {}
