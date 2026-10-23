import { argon2id } from "@noble/hashes/argon2.js";
import { Effect } from "effect";

// Matches oslo's Argon2id defaults used by the original website, so existing
// PHC hashes verify and new hashes stay compatible.
const defaults = { m: 19_456, t: 2, p: 1, dkLen: 32 } as const;

const encodeBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, "");

const decodeBase64 = (value: string) =>
  Uint8Array.from(atob(value.padEnd(Math.ceil(value.length / 4) * 4, "=")), (character) =>
    character.charCodeAt(0),
  );

const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!;
  return difference === 0;
};

const parse = (encoded: string) => {
  const [, algorithm, version, parameters, salt, hash] = encoded.split("$");
  if (algorithm !== "argon2id" || version !== "v=19" || !parameters || !salt || !hash)
    return undefined;
  const values = Object.fromEntries(
    parameters.split(",").map((entry) => {
      const [key, value] = entry.split("=");
      return [key, Number(value)];
    }),
  );
  const { m, t, p } = values;
  if (![m, t, p].every((value) => Number.isSafeInteger(value) && value! > 0)) return undefined;
  // Bound work so a corrupted row cannot exhaust the Worker's memory or CPU.
  if (m! > 65_536 || t! > 10 || p! > 4) return undefined;
  try {
    return { m: m!, t: t!, p: p!, salt: decodeBase64(salt), hash: decodeBase64(hash) };
  } catch {
    return undefined;
  }
};

export const hash = (password: string) =>
  Effect.sync(() => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = argon2id(password, salt, defaults);
    return `$argon2id$v=19$m=${defaults.m},t=${defaults.t},p=${defaults.p}$${encodeBase64(salt)}$${encodeBase64(derived)}`;
  });

export const verify = (encoded: string, password: string) =>
  Effect.sync(() => {
    const parsed = parse(encoded);
    if (parsed === undefined) return false;
    const derived = argon2id(password, parsed.salt, {
      m: parsed.m,
      t: parsed.t,
      p: parsed.p,
      dkLen: parsed.hash.length,
    });
    return constantTimeEqual(derived, parsed.hash);
  });
