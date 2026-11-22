import { Effect, Schema } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Written by `@macrograph/vite-shared-libraries` next to the built client. */
export const file = ".macrograph/shared-libraries.json";

const CspHash = Schema.String.check(Schema.isPattern(/^'sha(256|384|512)-[A-Za-z0-9+/]+={0,2}'$/));

const Manifest = Schema.fromJsonString(Schema.Struct({ scriptSrc: Schema.Array(CspHash) }));

/**
 * CSP `script-src` sources the built client needs, such as the hash of its inline import map.
 * Empty when the client directory has no build manifest.
 *
 * Read synchronously: an asynchronous step while building the static routes leaves requests that
 * arrive right after the server starts listening unanswered.
 */
export const scriptSources = (root: string) =>
  Effect.suspend(() => {
    const target = join(root, file);
    if (!existsSync(target)) return Effect.succeed<ReadonlyArray<string>>([]);
    return Schema.decodeUnknownEffect(Manifest)(readFileSync(target, "utf8")).pipe(
      Effect.map((manifest) => manifest.scriptSrc),
    );
  }).pipe(Effect.orDie);

export * as ClientBuildManifest from "./ClientBuildManifest.ts";
