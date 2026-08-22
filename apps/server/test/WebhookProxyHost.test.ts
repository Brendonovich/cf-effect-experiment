import { assert, it } from "@effect/vitest";
import { EngineHost } from "@macrograph/project-host";
import Kofi from "@macrograph/plugin-kofi/Deployment/Webhook";
import { Effect } from "effect";

import { WebhookProxyHost } from "../src/WebhookProxyHost.ts";

it.effect("maps HTTP ingress requirements to webhook proxy endpoints", () =>
	Effect.gen(function* () {
		const host = yield* EngineHost.HttpIngressHost;
		const endpoints = yield* host.reconcile("kofi", {
			webhooks: { primary: { verificationToken: "secret" } },
		});

		assert.deepStrictEqual(endpoints, [
			{
				id: "kofi:kofi:payment:primary",
				url: "https://proxy.example/webhooks/kofi/kofi%3Apayment/primary?forward=wss%3A%2F%2Fserver.example%2Fingress",
				handlerId: "kofi:payment",
				instanceKey: "primary",
				metadata: { webhookId: "primary" },
			},
		]);
	}).pipe(
		Effect.provide(
        WebhookProxyHost.layer({
				deployments: [Kofi],
				publicUrl: "https://proxy.example/webhooks",
				websocketUrl: "wss://server.example/ingress",
			}),
		),
	),
);
