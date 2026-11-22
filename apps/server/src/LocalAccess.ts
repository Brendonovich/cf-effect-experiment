import { ApiCaller } from "@macrograph/project-api";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The background service's local token. Whoever can read the service's per-user files holds it,
 * so requests bearing it act with the owner's rights, even before the server has been set up.
 */
export interface Access {
  readonly enabled: boolean;
  readonly matches: (token: string | undefined) => boolean;
}

/**
 * The user ID that local-token requests act as. Cloud user IDs never contain a colon, so this
 * cannot collide with a signed-in user or an API key's creator.
 */
export const userId = "macrograph:local";

/** The REST or MCP caller for local-token requests, as shown in presence and edit attribution. */
export const caller: ApiCaller.Caller = { ...ApiCaller.anonymous, id: "local" };

export const none: Access = { enabled: false, matches: () => false };

const digest = (value: string) => createHash("sha256").update(value).digest();

export const make = (token: string): Access => {
  // Comparing fixed-length digests keeps the comparison constant-time regardless of input length.
  const expected = digest(token);
  return {
    enabled: true,
    matches: (provided) => provided !== undefined && timingSafeEqual(digest(provided), expected),
  };
};

export const generateToken = () => randomBytes(32).toString("base64url");

/** Reads a bearer token from an `Authorization` header value. */
export const bearer = (authorization: string | undefined) =>
  /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];

export * as LocalAccess from "./LocalAccess.ts";
