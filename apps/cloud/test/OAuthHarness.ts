import type { PGlite } from "@electric-sql/pglite";

import { assert } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option, Ref } from "effect";
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as OAuthProviders from "../src/auth/OAuthProviders.ts";
import * as Analytics from "../src/website/Analytics.ts";
import * as Jwt from "../src/website/Jwt.ts";
import * as WebsiteRoutes from "../src/website/WebsiteRoutes.ts";
import * as PgliteDatabase from "./PgliteDatabase.ts";

export const origin = "https://macrograph.app";
export const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";

const generateRsaPem = Effect.promise(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
});

const providersLayer = OAuthProviders.layer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ TWITCH_CLIENT_ID: "client", TWITCH_CLIENT_SECRET: "secret" }),
    ),
  ),
);

export type App = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  unknown,
  HttpServerRequest.HttpServerRequest
>;

export interface Harness {
  readonly app: App;
  readonly pg: PGlite;
  /** Moves the OAuth server's clock forward. */
  readonly advance: (ms: number) => void;
  /** The OAuth server's clock, for clients that should share it. */
  readonly now: () => number;
}

export const harnessWith = (
  overrides: Partial<
    Pick<WebsiteRoutes.Options, "authRedirectOrigin" | "providerRedirectOrigins">
  > = {},
) =>
  Effect.gen(function* () {
    const pg = yield* PgliteDatabase.make;
    const stateKey = yield* Jwt.hmacKey("state-secret");
    const signingKey = yield* Jwt.rsaKey(yield* generateRsaPem);
    let offset = 0;
    const app = yield* WebsiteRoutes.layer({
      stateKey: Effect.succeed(stateKey),
      signingKey: Effect.succeed(signingKey),
      issuer: origin,
      authRedirectOrigin: origin,
      capture: Analytics.disabled,
      now: () => Date.now() + offset,
      ...overrides,
    }).pipe(Layer.provide([PgliteDatabase.layer(pg), providersLayer]), HttpRouter.toHttpEffect);
    return {
      app,
      pg,
      advance: (ms: number) => {
        offset += ms;
      },
      now: () => Date.now() + offset,
    } satisfies Harness;
  });

export const harness = harnessWith();

export const send = (app: App, path: string, init?: RequestInit) =>
  Effect.gen(function* () {
    const response = yield* Ref.make(Option.none<HttpServerResponse.HttpServerResponse>());
    yield* HttpEffect.toHandled(app, (_, value) => Ref.set(response, Option.some(value))).pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request(`${origin}${path}`, {
            ...init,
            headers: { "x-forwarded-host": new URL(origin).host, ...init?.headers },
          }),
        ),
      ),
    );
    return HttpServerResponse.toWeb(Option.getOrThrow(yield* Ref.get(response)));
  });

export const body = (response: Response) =>
  Effect.promise(async (): Promise<Record<string, unknown>> => {
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("Expected a JSON object");
    return value as Record<string, unknown>;
  });

export const string = (value: unknown) => {
  assert.isString(value);
  return value as string;
};

export const form = (params: Record<string, string>, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
  body: new URLSearchParams(params).toString(),
});

export const basic = (id: string, secret: string) => ({
  authorization: `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)}`,
});

export const signIn = (pg: PGlite, id: string) =>
  Effect.promise(async () => {
    await pg.query(`insert into "user" (id, email, hashed_password) values ($1, $2, 'x')`, [
      id,
      `${id}@example.com`,
    ]);
    await pg.query(
      `insert into "user_identity" (provider_id, provider_user_id, user_id) values ('github', $1, $1)`,
      [id],
    );
    await pg.query(
      `insert into "session" (id, user_id, expires_at) values ($1, $2, now() + interval '20 days')`,
      [`session-${id}`, id],
    );
    return { cookie: `auth_session=session-${id}`, origin };
  });

export const website = (app: App, session: Record<string, string>, path: string, value: unknown) =>
  send(app, `/api/website/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...session },
    body: JSON.stringify(value),
  });
