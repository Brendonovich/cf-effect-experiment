import { Engine, HttpIngress } from "@macrograph/plugin";
import { EngineHost } from "@macrograph/project-host";
import { Effect, Layer } from "effect";

export interface Options {
	readonly deployments: ReadonlyArray<Engine.AnyHttpIngressDeployment>;
	readonly publicUrl: string;
	readonly websocketUrl: string;
}

const segment = encodeURIComponent;

export const layer = (options: Options) =>
	Layer.succeed(EngineHost.HttpIngressHost, {
		reconcile: (pluginId, state) => {
			const deployment = options.deployments.find(
				(candidate) => candidate.pluginId === pluginId,
			);
			if (deployment === undefined)
				return Effect.die(`HTTP ingress deployment ${pluginId} is not registered`);

			return deployment.httpIngress.resolveRequirements(state).pipe(
				Effect.flatMap(HttpIngress.manifest),
				Effect.tap((manifest) =>
					Effect.logInfo("Reconciling webhook proxy", {
						pluginId,
						websocketUrl: options.websocketUrl,
						manifest,
					}),
				),
				Effect.map((manifest) =>
					manifest.map((entry) => {
						const id = `${entry.pluginId}:${entry.handlerId}:${entry.instanceKey}`;
						const path = [entry.pluginId, entry.handlerId, entry.instanceKey]
							.map(segment)
							.join("/");
						const url = new URL(`${options.publicUrl.replace(/\/$/, "")}/${path}`);
						url.searchParams.set("forward", options.websocketUrl);
						return {
							id,
							url: url.toString(),
							handlerId: entry.handlerId,
							instanceKey: entry.instanceKey,
							metadata: entry.metadata,
						};
					}),
				),
				Effect.orDie,
			);
		},
	});

export * as WebhookProxyHost from "./WebhookProxyHost.ts";
