import type { SessionStatus, WebsiteSession } from "@macrograph/cloud-api";
import type { Effect } from "effect";

import { runApi } from "./api";
import { tryWebsiteLogin } from "./websiteLogin";

interface SessionApi {
  get(): Effect.Effect<SessionStatus, unknown>;
  start(): Effect.Effect<SessionStatus, unknown>;
  poll(): Effect.Effect<SessionStatus, unknown>;
  startWebsite(): Effect.Effect<WebsiteSession, unknown>;
  pollWebsite(options: {
    payload: { registrationId: string };
  }): Effect.Effect<SessionStatus, unknown>;
}

export async function* cloudLogin(
  session: SessionApi,
  useWebsiteLogin: boolean,
  sleep = (duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration)),
): AsyncGenerator<SessionStatus | { state: "failed" }> {
  let state = await runApi(session.get());
  if (state === undefined) {
    yield { state: "failed" };
    return;
  }

  let websiteSession: WebsiteSession | undefined;
  if (state.state !== "connected" && useWebsiteLogin) {
    websiteSession = await runApi(session.startWebsite());
    if (websiteSession !== undefined)
      state = { state: "pending", verificationUrl: websiteSession.verificationUrl };
  }
  if (websiteSession === undefined) {
    if (state.state === "disconnected") state = await runApi(session.start());
    else if (state.state === "pending") state = await runApi(session.poll());
  }
  if (state === undefined) {
    yield { state: "failed" };
    return;
  }
  yield state;

  let polls = 0;
  while (state.state === "pending") {
    if (websiteSession !== undefined && polls++ % 5 === 0) {
      const approval = await tryWebsiteLogin(websiteSession.verificationUrl);
      if (approval === "retry") {
        // A 409 means the website is signed in. Check for manual approval before replacing
        // an expired attempt; if the website is unavailable, keep the manual attempt alive.
        const previous = await runApi(
          session.pollWebsite({ payload: { registrationId: websiteSession.registrationId } }),
        );
        if (previous?.state === "connected") {
          yield previous;
          return;
        }
        const renewed = await runApi(session.startWebsite());
        if (renewed !== undefined) {
          websiteSession = renewed;
          polls = 0;
          yield { state: "pending", verificationUrl: renewed.verificationUrl };
          continue;
        }
      }
    }
    await sleep(2000);
    const next = await runApi(
      websiteSession === undefined
        ? session.poll()
        : session.pollWebsite({ payload: { registrationId: websiteSession.registrationId } }),
    );
    if (next === undefined) {
      yield { state: "failed" };
      return;
    }
    state = next;
    yield state;
  }
}
