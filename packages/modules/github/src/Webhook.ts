import { HttpEndpoint, HttpIngress } from "@macrograph/module";
import { Effect, Redacted, Schema } from "effect";

import { makeAppApi } from "./AppApi.ts";
import {
  InstallationId,
  RepositoryId,
  WebhookDelivery,
  WebhookEventName,
  WebhookId,
} from "./Definition.ts";

export const WebhookMetadata = Schema.Struct({
  webhookId: WebhookId,
  installationId: InstallationId,
  repositoryId: RepositoryId,
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

const belongsToEndpoint = (hookUrl: string, endpointUrl: string) => {
  if (hookUrl === endpointUrl) return true;
  if (!URL.canParse(hookUrl) || !URL.canParse(endpointUrl)) return false;
  return new URL(hookUrl).pathname === new URL(endpointUrl).pathname;
};

export const handler = WebhookIngress.implement(
  Effect.gen(function* () {
    const endpoints = yield* HttpEndpoint.Host;
    const app = yield* makeAppApi();
    return Effect.succeed({
      mount: Effect.fnUntraced(function* ({ endpoint, configuration }) {
        const metadata = endpoint.metadata;
        const token = yield* app.installationToken(metadata.installationId);
        const hooks = yield* app.listHooks(token, metadata.owner, metadata.repository);
        const owned = hooks.filter((hook) => belongsToEndpoint(hook.url, endpoint.url));
        const primary = owned.find((hook) => hook.url === endpoint.url) ?? owned[0];
        yield* Effect.forEach(
          owned.filter((hook) => hook.id !== primary?.id),
          (hook) => app.deleteHook(token, metadata.owner, metadata.repository, hook.id),
          { discard: true },
        );
        yield* app.saveHook(
          token,
          metadata.owner,
          metadata.repository,
          endpoint.url,
          yield* endpoints.secret(endpoint.id),
          configuration.events,
          primary?.id,
        );
      }),
      unmount: Effect.fnUntraced(function* ({ endpoint }) {
        const metadata = endpoint.metadata;
        const token = yield* app.installationToken(metadata.installationId);
        const hooks = yield* app.listHooks(token, metadata.owner, metadata.repository);
        yield* Effect.forEach(
          hooks.filter((hook) => belongsToEndpoint(hook.url, endpoint.url)),
          (hook) => app.deleteHook(token, metadata.owner, metadata.repository, hook.id),
          { discard: true },
        );
      }),
      handle: Effect.fnUntraced(function* (request) {
        const deliveryId = header(request.headers, "x-github-delivery");
        const event = header(request.headers, "x-github-event");
        const signature = header(request.headers, "x-hub-signature-256");
        const targetId = header(request.headers, "x-github-hook-installation-target-id");
        const targetType = header(request.headers, "x-github-hook-installation-target-type");
        if (
          deliveryId === undefined ||
          event === undefined ||
          signature === undefined ||
          targetType?.toLowerCase() !== "repository" ||
          targetId !== request.endpoint.metadata.repositoryId
        )
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
        const installation = object.installation;
        const repository = object.repository;
        if (
          (installation !== undefined &&
            (typeof installation !== "object" ||
              installation === null ||
              !("id" in installation) ||
              typeof installation.id !== "number" ||
              String(installation.id) !== request.endpoint.metadata.installationId)) ||
          typeof repository !== "object" ||
          repository === null ||
          !("id" in repository) ||
          typeof repository.id !== "number" ||
          String(repository.id) !== request.endpoint.metadata.repositoryId
        )
          return { status: 400 };
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
