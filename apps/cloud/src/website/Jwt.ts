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

/** The public half of an RSA signing key, as published in a JWK Set (RFC 7517). */
export interface PublicJwk {
  readonly kty: "RSA";
  readonly n: string;
  readonly e: string;
  readonly alg: "RS256";
  readonly use: "sig";
  readonly kid: string;
}

export interface SigningKey {
  readonly algorithm: "HS256" | "RS256";
  readonly sign: CryptoKey;
  readonly verify: CryptoKey;
  /** Set for asymmetric keys, which can be published. */
  readonly publicJwk?: PublicJwk;
}

export type VerifyKey = Pick<SigningKey, "algorithm" | "verify">;

/** RFC 7638 JWK thumbprint of an RSA public key, used as its `kid`. */
export const rsaThumbprint = async (jwk: { readonly n: string; readonly e: string }) => {
  // Required members only, in lexicographic order, with no whitespace.
  const canonical = JSON.stringify({ e: jwk.e, kty: "RSA", n: jwk.n });
  const digest = await crypto.subtle.digest("SHA-256", bytes.encode(canonical));
  return base64UrlEncode(new Uint8Array(digest));
};

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
    if (jwk.n === undefined || jwk.e === undefined) throw new Error("Not an RSA key");
    const verify = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      algorithm,
      false,
      ["verify"],
    );
    const kid = await rsaThumbprint({ n: jwk.n, e: jwk.e });
    return {
      algorithm: "RS256",
      sign,
      verify,
      publicJwk: { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid },
    };
  });

/** A verify-only key from a published JWK, such as another stage's `/oauth/jwks`. */
export const rsaPublicKey = (jwk: { readonly n: string; readonly e: string }) =>
  Effect.tryPromise(
    async (): Promise<VerifyKey> => ({
      algorithm: "RS256",
      verify: await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    }),
  );

export const sign = (
  key: SigningKey,
  payload: Readonly<Record<string, unknown>>,
  header: { readonly typ?: string } = {},
) =>
  Effect.promise(async () => {
    const input = `${encodeJson({
      alg: key.algorithm,
      ...(key.publicJwk === undefined ? {} : { kid: key.publicJwk.kid }),
      ...header,
    })}.${encodeJson(payload)}`;
    const signature = await crypto.subtle.sign(
      signingParams(key.algorithm),
      key.sign,
      bytes.encode(input),
    );
    return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
  });

/** Verifies a compact JWS and returns its payload, or `undefined` when it is invalid or expired. */
export const verify = (key: VerifyKey, token: string) =>
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
