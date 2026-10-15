import { Effect, Schema } from "effect";
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest } from "effect/http";

import {
  AccountId,
  ClientRpcs,
  RuntimeRpcs,
  SendblueAccount,
  SendblueEngine,
  SendblueFailure,
} from "./Definition.ts";

const SendMessageResponse = Schema.Struct({
  message_handle: Schema.String,
  status: Schema.String,
  service: Schema.optionalKey(Schema.String),
  was_downgraded: Schema.optionalKey(Schema.Boolean),
});

const validSecret = (value: string) => /^[\x21-\x7e]{1,4096}$/.test(value);
const validNumber = (value: string) => /^\+[1-9]\d{6,14}$/.test(value);

export const layer = SendblueEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);

    return SendblueEngine.of({
      resources: SendblueAccount.toLayer(
        mg.storage.get.pipe(
          Effect.map(({ accounts }) =>
            Object.entries(accounts).map(([id, account]) => ({
              id: AccountId.make(id),
              display: account.name,
            })),
          ),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        SendblueSendMessage: Effect.fnUntraced(
          function* ({ accountId, fromNumber, number, content, mediaUrl }) {
            const account = (yield* mg.storage.get).accounts[accountId];
            if (account === undefined)
              return yield* new SendblueFailure({
                operation: "send",
                reason: "API credentials are not configured",
              });
            const from = fromNumber.trim();
            const to = number.trim();
            const message = content.trim();
            const media = mediaUrl.trim();
            if (
              !validNumber(from) ||
              !validNumber(to) ||
              (message.length === 0 && media.length === 0)
            )
              return yield* new SendblueFailure({ operation: "send", reason: "Invalid input" });

            const request = yield* HttpClientRequest.post(
              "https://api.sendblue.com/api/send-message",
            ).pipe(
              HttpClientRequest.setHeader("sb-api-key-id", account.apiKey),
              HttpClientRequest.setHeader("sb-api-secret-key", account.apiSecret),
              HttpClientRequest.acceptJson,
              HttpClientRequest.bodyJson({
                from_number: from,
                number: to,
                ...(message.length > 0 ? { content: message } : {}),
                ...(media.length > 0 ? { media_url: media } : {}),
              }),
              Effect.mapError(
                () => new SendblueFailure({ operation: "send", reason: "Invalid input" }),
              ),
            );
            const response = yield* client
              .execute(request)
              .pipe(
                Effect.mapError(
                  () => new SendblueFailure({ operation: "send", reason: "Request failed" }),
                ),
              );
            if (response.status < 200 || response.status >= 300)
              return yield* new SendblueFailure({
                operation: "send",
                reason: "Provider rejected request",
                status: response.status,
              });
            const json = yield* response.json.pipe(
              Effect.mapError(
                () =>
                  new SendblueFailure({ operation: "send", reason: "Invalid provider response" }),
              ),
            );
            const result = yield* Schema.decodeUnknownEffect(SendMessageResponse)(json).pipe(
              Effect.mapError(
                () =>
                  new SendblueFailure({ operation: "send", reason: "Invalid provider response" }),
              ),
            );
            return {
              messageHandle: result.message_handle,
              status: result.status,
              service: result.service ?? "",
              wasDowngraded: result.was_downgraded ?? false,
            };
          },
          (effect) =>
            effect.pipe(
              Effect.scoped,
              Effect.updateService(Headers.CurrentRedactedNames, (names) => [
                ...names,
                "sb-api-key-id",
                "sb-api-secret-key",
              ]),
              Effect.provideService(FetchHttpClient.RequestInit, {
                redirect: "manual",
                credentials: "omit",
              }),
              Effect.timeoutOrElse({
                duration: "30 seconds",
                orElse: () =>
                  new SendblueFailure({ operation: "send", reason: "Request timed out" }),
              }),
            ),
        ),
      }),
      client: {
        state: mg.storage.get.pipe(
          Effect.map(({ accounts }) => ({
            accounts: Object.entries(accounts).map(([id, account]) => ({
              id: AccountId.make(id),
              name: account.name,
              mode: account.mode,
            })),
          })),
        ),
        rpcs: ClientRpcs.toLayer({
          SendblueCreateAccount: Effect.fnUntraced(function* ({
            name,
            apiKey,
            apiSecret,
            webhookSecret,
            mode,
          }) {
            const accountName = name.trim();
            const key = apiKey.trim();
            const secret = apiSecret.trim();
            const signingSecret = webhookSecret.trim();
            if (
              accountName.length === 0 ||
              !validSecret(key) ||
              !validSecret(secret) ||
              (mode === "webhook" && !validSecret(signingSecret))
            )
              return yield* new SendblueFailure({ operation: "settings", reason: "Invalid input" });
            const accountId = AccountId.make(crypto.randomUUID());
            yield* mg.storage.update((storage) => ({
              accounts: {
                ...storage.accounts,
                [accountId]: {
                  name: accountName,
                  apiKey: key,
                  apiSecret: secret,
                  webhookSecret: mode === "webhook" ? signingSecret : null,
                  mode,
                },
              },
            }));
            yield* mg.resource.refresh(SendblueAccount);
            yield* mg.client.refresh;
            return accountId;
          }),
          SendblueRemoveAccount: Effect.fnUntraced(function* ({ accountId }) {
            yield* mg.storage.update((storage) => ({
              accounts: Object.fromEntries(
                Object.entries(storage.accounts).filter(([id]) => id !== accountId),
              ),
            }));
            yield* mg.resource.refresh(SendblueAccount);
            yield* mg.client.refresh;
          }),
        }),
      },
    });
  }),
);

export default layer;
