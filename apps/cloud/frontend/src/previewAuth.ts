import type { SessionStatus } from "@macrograph/cloud-api";

import { Effect } from "effect";

import { runApi } from "./api";

const attemptPrefix = "macrograph-preview-auth:";
const attemptLifetime = 5 * 60 * 1_000;

interface SessionApi {
  get(): Effect.Effect<SessionStatus, unknown>;
}

interface Attempt {
  readonly verifier: string;
  readonly redirectUri: string;
  readonly next: string;
  readonly createdAt: number;
}

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const randomValue = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

const challengeFor = async (verifier: string) =>
  base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );

export const isPreviewDeployment = () =>
  /^pr\d+$/.test(import.meta.env.VITE_DEPLOYMENT_STAGE ?? "");

export async function* previewSession(
  session: SessionApi,
): AsyncGenerator<SessionStatus | { state: "failed" }> {
  const status = await runApi(session.get().pipe(Effect.timeout("15 seconds")));
  yield status ?? { state: "failed" };
}

export const beginPreviewAuthentication = async (next: string) => {
  const verifier = randomValue();
  const state = randomValue();
  const redirectUri = new URL("preview-auth/callback", location.origin + import.meta.env.BASE_URL)
    .href;
  const attempt: Attempt = { verifier, redirectUri, next, createdAt: Date.now() };
  sessionStorage.setItem(`${attemptPrefix}${state}`, JSON.stringify(attempt));

  const authorize = new URL("/preview-auth/authorize", "https://cloud.macrograph.app");
  authorize.searchParams.set("redirectUri", redirectUri);
  authorize.searchParams.set("codeChallenge", await challengeFor(verifier));
  authorize.searchParams.set("state", state);
  location.assign(authorize);
};

export const takePreviewAuthenticationAttempt = (state: string): Attempt | undefined => {
  const key = `${attemptPrefix}${state}`;
  const value = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (value === null) return undefined;
  try {
    const attempt: unknown = JSON.parse(value);
    if (
      typeof attempt !== "object" ||
      attempt === null ||
      !("verifier" in attempt) ||
      typeof attempt.verifier !== "string" ||
      !("redirectUri" in attempt) ||
      typeof attempt.redirectUri !== "string" ||
      !("next" in attempt) ||
      typeof attempt.next !== "string" ||
      !attempt.next.startsWith("/") ||
      attempt.next.startsWith("//") ||
      !("createdAt" in attempt) ||
      typeof attempt.createdAt !== "number" ||
      Date.now() - attempt.createdAt > attemptLifetime
    )
      return undefined;
    return {
      verifier: attempt.verifier,
      redirectUri: attempt.redirectUri,
      next: attempt.next,
      createdAt: attempt.createdAt,
    };
  } catch {
    return undefined;
  }
};
