import { CloudCredentials, SessionStoreError } from "@macrograph/cloud-credentials";
import type * as Engine from "@macrograph/plugin/Engine";
import { Effect } from "effect";

import type { StorageLike } from "./LocalStoragePersistence";

export const MACROGRAPH_AUTH_SESSION_KEY = "macrograph:local-browser:cloud-auth:v1";

export interface BrowserCredentialEnvironment {
  readonly storage: StorageLike;
  readonly fetch: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly now?: () => number;
}

export interface BrowserCredentialProvider {
  readonly service: Engine.CredentialService;
}

export const makeBrowserCredentialProvider = (
  environment: BrowserCredentialEnvironment,
): BrowserCredentialProvider => {
  const store: CloudCredentials.SessionStore = {
    read: Effect.try({
      try: () => environment.storage.getItem(MACROGRAPH_AUTH_SESSION_KEY),
      catch: () => new SessionStoreError({ reason: "Browser storage could not read MacroGraph authorization" }),
    }),
    write: (value) =>
      Effect.try({
        try: () => environment.storage.setItem(MACROGRAPH_AUTH_SESSION_KEY, value),
        catch: () =>
          new SessionStoreError({
            reason: "Browser storage could not persist MacroGraph authorization",
          }),
      }),
    clear: Effect.try({
      try: () => environment.storage.removeItem(MACROGRAPH_AUTH_SESSION_KEY),
      catch: () => new SessionStoreError({ reason: "Browser storage could not remove MacroGraph authorization" }),
    }),
  };
  return {
    service: CloudCredentials.make({
      store,
      fetch: environment.fetch,
      ...(environment.baseUrl === undefined ? {} : { baseUrl: environment.baseUrl }),
      ...(environment.now === undefined ? {} : { now: environment.now }),
    }).credentials,
  };
};
