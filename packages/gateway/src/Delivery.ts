/**
 * Outbound webhooks: each delivery is signed so receivers can check it came from the gateway.
 *
 * The `MacroGraph-Signature` header is `t=<unix seconds>,v1=<hex HMAC-SHA256>`, where the HMAC uses
 * the webhook's secret over `${t}.${body}`.
 */

export const signatureHeader = "macrograph-signature";

/** Seconds to wait before each retry; a delivery is dropped after the last one fails. */
export const retryDelaysSeconds: ReadonlyArray<number> = [10, 60, 300, 1800, 7200, 21600];

const encoder = new TextEncoder();

const hmac = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

export const sign = async (secret: string, timestamp: number, body: string) =>
  `t=${timestamp},v1=${await hmac(secret, `${timestamp}.${body}`)}`;

/** Checks a signature header, rejecting timestamps more than `toleranceSeconds` from `now`. */
export const verify = async (
  secret: string,
  header: string,
  body: string,
  options: { readonly now?: number; readonly toleranceSeconds?: number } = {},
) => {
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || typeof parts.v1 !== "string") return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? 300)) return false;
  const expected = await hmac(secret, `${timestamp}.${body}`);
  if (expected.length !== parts.v1.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++)
    difference |= expected.charCodeAt(index) ^ parts.v1.charCodeAt(index);
  return difference === 0;
};

export const generateSecret = () =>
  `mgws_${Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;

/** Webhook targets must be public HTTPS URLs. */
export const validTarget = (value: string) => {
  if (value.length > 2048 || !URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname;
  return !(
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^(127|10|0)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host.startsWith("[")
  );
};
