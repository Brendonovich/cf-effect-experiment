import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Effect, Schema } from "effect";

export class AtomicFileStoreError extends Schema.TaggedError<AtomicFileStoreError>()(
  "AtomicFileStoreError",
  { reason: Schema.String },
) {}

export interface AtomicFileStore {
  readonly read: Effect.Effect<string | null, AtomicFileStoreError>;
  readonly write: (value: string) => Effect.Effect<void, AtomicFileStoreError>;
  readonly clear: Effect.Effect<void, AtomicFileStoreError>;
}

const failure = (operation: string) =>
  new AtomicFileStoreError({ reason: `Could not ${operation} the protected server credential store` });

export const makeAtomicFileStore = (path: string): AtomicFileStore => {
  const directory = dirname(path);
  const prepare = () => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  };
  return {
    read: Effect.try({
      try: () => {
        prepare();
        try {
          const value = readFileSync(path, "utf8");
          chmodSync(path, 0o600);
          return value;
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return null;
          throw error;
        }
      },
      catch: () => failure("read"),
    }),
    write: (value) =>
      Effect.try({
        try: () => {
          prepare();
          const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
          try {
            writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
            chmodSync(temporary, 0o600);
            renameSync(temporary, path);
            chmodSync(path, 0o600);
          } catch (error) {
            try {
              rmSync(temporary, { force: true });
            } catch {
              // The original error is more actionable than temporary-file cleanup failure.
            }
            throw error;
          }
        },
        catch: () => failure("write"),
      }),
    clear: Effect.try({
      try: () => rmSync(path, { force: true }),
      catch: () => failure("remove"),
    }),
  };
};
