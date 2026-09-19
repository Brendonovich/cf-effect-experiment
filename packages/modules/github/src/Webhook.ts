import { HttpEndpoint, HttpIngress } from "@macrograph/module";
import { Effect, Redacted, Schema } from "effect";

import { WebhookDelivery, WebhookEventName, WebhookId } from "./Definition.ts";

export const WebhookMetadata = Schema.Struct({
  webhookId: WebhookId,
  owner: Schema.String,
  repository: Schema.String,
});
export const WebhookConfiguration = Schema.Struct({ events: Schema.Array(WebhookEventName) });

export const WebhookIngress = HttpIngress.make({
  id: "github:repository",
  moduleId: "github",
  displayName: "Repository Webhook",
  method: "POST",
  metadata: WebhookMetadata,
  event: WebhookDelivery,
  configuration: WebhookConfiguration,
  mergeConfiguration: (current, next) => ({
    events: [...new Set([...current.events, ...next.events])],
  }),
  accepts: (configuration, eventType) =>
    eventType === "GitHubWebhookDelivery" && configuration.events.length > 0,
});

const header = (headers: Readonly<Record<string, string | undefined>>, name: string) =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index++)
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
};

export const handler = WebhookIngress.implement(
  Effect.gen(function* () {
    const endpoints = yield* HttpEndpoint.Host;
    return Effect.succeed({
      handle: Effect.fnUntraced(function* (request) {
        const deliveryId = header(request.headers, "x-github-delivery");
        const event = header(request.headers, "x-github-event");
        const signature = header(request.headers, "x-hub-signature-256");
        if (deliveryId === undefined || event === undefined || signature === undefined)
          return { status: 400 };
        const secret = yield* endpoints.secret(request.endpoint.id);
        const key = yield* Effect.tryPromise({
          try: () =>
            crypto.subtle.importKey(
              "raw",
              new TextEncoder().encode(Redacted.value(secret)),
              { name: "HMAC", hash: "SHA-256" },
              false,
              ["sign"],
            ),
          catch: () => undefined,
        }).pipe(Effect.option);
        if (key._tag === "None") return { status: 500 };
        const digest = yield* Effect.tryPromise({
          try: () => crypto.subtle.sign("HMAC", key.value, Uint8Array.from(request.body)),
          catch: () => undefined,
        }).pipe(Effect.option);
        if (
          digest._tag === "None" ||
          !safeEqual(`sha256=${hex(digest.value)}`, signature.toLowerCase())
        )
          return { status: 403 };
        if (event === "ping") return { status: 200 };
        if (!Schema.is(WebhookEventName)(event)) return { status: 204 };
        if (!request.configuration.events.includes(event)) return { status: 204 };
        const payload = yield* Effect.try({
          try: () => JSON.parse(new TextDecoder().decode(request.body)) as unknown,
          catch: () => undefined,
        }).pipe(Effect.option);
        if (
          payload._tag === "None" ||
          typeof payload.value !== "object" ||
          payload.value === null ||
          Array.isArray(payload.value)
        )
          return { status: 400 };
        const object = payload.value as Record<string, unknown>;
        const action = typeof object.action === "string" ? object.action : "";
        const sender =
          typeof object.sender === "object" &&
          object.sender !== null &&
          "login" in object.sender &&
          typeof object.sender.login === "string"
            ? object.sender.login
            : "";
        const webhook = request.endpoint.metadata;
        return {
          status: 202,
          events: [
            {
              event: new WebhookDelivery({
                webhookId: webhook.webhookId,
                event,
                action,
                owner: webhook.owner,
                repository: webhook.repository,
                sender,
                deliveryId,
                payloadJson: JSON.stringify(payload.value),
              }),
              eventId: deliveryId,
            },
          ],
        };
      }),
    });
  }),
);
