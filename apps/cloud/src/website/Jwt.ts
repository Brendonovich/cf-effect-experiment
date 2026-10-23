import { Effect } from "effect";

const bytes = new TextEncoder();

export const base64UrlEncode = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export const base64UrlDecode = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(
    atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    (character) => character.charCodeAt(0),
  );
};

const encodeJson = (value: unknown) => base64UrlEncode(bytes.encode(JSON.stringify(value)));

export interface SigningKey {
  readonly algorithm: "HS256" | "RS256";
  readonly sign: CryptoKey;
  readonly verify: CryptoKey;
}

const signingParams = (algorithm: SigningKey["algorithm"]) =>
  algorithm === "HS256" ? { name: "HMAC" } : { name: "RSASSA-PKCS1-v1_5" };

export const hmacKey = (secret: string) =>
  Effect.promise(async (): Promise<SigningKey> => {
    const key = await crypto.subtle.importKey(
      "raw",
      bytes.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    return { algorithm: "HS256", sign: key, verify: key };
  });

/** Imports a PKCS#8 PEM RSA key, accepting the escaped newlines used in environment variables. */
export const rsaKey = (pem: string) =>
  Effect.tryPromise(async (): Promise<SigningKey> => {
    const body = pem
      .replaceAll("\\n", "\n")
      .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
      .replace(/\s+/g, "");
    const der = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
    const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const sign = await crypto.subtle.importKey("pkcs8", der, algorithm, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", sign);
    const verify = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      algorithm,
      false,
      ["verify"],
    );
    return { algorithm: "RS256", sign, verify };
  });

export const sign = (key: SigningKey, payload: Readonly<Record<string, unknown>>) =>
  Effect.promise(async () => {
    const input = `${encodeJson({ alg: key.algorithm })}.${encodeJson(payload)}`;
    const signature = await crypto.subtle.sign(
      signingParams(key.algorithm),
      key.sign,
      bytes.encode(input),
    );
    return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
  });

/** Verifies a compact JWS and returns its payload, or `undefined` when it is invalid or expired. */
export const verify = (key: SigningKey, token: string) =>
  Effect.promise(async (): Promise<Readonly<Record<string, unknown>> | undefined> => {
    try {
      const [header, payload, signature] = token.split(".");
      if (header === undefined || payload === undefined || signature === undefined)
        return undefined;
      const decodedHeader: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(header)));
      if (
        typeof decodedHeader !== "object" ||
        decodedHeader === null ||
        !("alg" in decodedHeader) ||
        decodedHeader.alg !== key.algorithm
      )
        return undefined;
      const valid = await crypto.subtle.verify(
        signingParams(key.algorithm),
        key.verify,
        base64UrlDecode(signature),
        bytes.encode(`${header}.${payload}`),
      );
      if (!valid) return undefined;
      const claims: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
      if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return undefined;
      const record = claims as Readonly<Record<string, unknown>>;
      if (typeof record.exp === "number" && record.exp * 1000 <= Date.now()) return undefined;
      return record;
    } catch {
      return undefined;
    }
  });
