import { Effect } from "effect";

export type Event =
  | { readonly event: "user signed up"; readonly email: string }
  | { readonly event: "user logged in" }
  | {
      readonly event: "credential connected" | "credential refreshed";
      readonly providerId: string;
      readonly providerUserId: string;
    };

export type Capture = (distinctId: string, event: Event) => Effect.Effect<void>;

export const disabled: Capture = () => Effect.void;

// The original website's PostHog project.
const apiKey = "phc_7anSDyS3p1frzGL7bHWlkiNG8kJ9pxcHB8H7QjBMEMB";

const send = (body: Readonly<Record<string, unknown>>) =>
  Effect.tryPromise(() =>
    fetch("https://us.i.posthog.com/i/v0/e/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, ...body }),
    }),
  ).pipe(Effect.timeout("2 seconds"), Effect.ignore);

export const posthog: Capture = (distinctId, event) => {
  switch (event.event) {
    case "user signed up":
      return Effect.all(
        [
          send({
            event: "$identify",
            distinct_id: distinctId,
            properties: { $set: { email: event.email } },
          }),
          send({ event: event.event, distinct_id: distinctId }),
        ],
        { concurrency: "unbounded", discard: true },
      );
    case "user logged in":
      return send({ event: event.event, distinct_id: distinctId });
    default:
      return send({
        event: event.event,
        distinct_id: distinctId,
        properties: { providerId: event.providerId, providerUserId: event.providerUserId },
      });
  }
};
