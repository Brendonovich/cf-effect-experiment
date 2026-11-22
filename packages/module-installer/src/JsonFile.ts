import { Effect, Schema } from "effect";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonFileError extends Schema.TaggedError<JsonFileError>()("ModuleInstallerFileError", {
  path: Schema.String,
  message: Schema.String,
}) {}

const isMissing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export interface JsonFile<A> {
  readonly path: string;
  /** Reads and decodes the file, or returns `initial` when it doesn't exist. */
  readonly read: Effect.Effect<A, JsonFileError>;
  /** Writes through a temporary file and a rename, so readers never see a partial file. */
  readonly write: (value: A) => Effect.Effect<void, JsonFileError>;
}

export const make = <S extends Schema.Codec<unknown, unknown>>(
  path: string,
  schema: S,
  initial: S["Type"],
): JsonFile<S["Type"]> => {
  const codec = Schema.fromJsonString(schema);
  const decode = Schema.decodeUnknownEffect(codec);
  const encode = Schema.encodeUnknownEffect(codec);
  return {
    path,
    read: Effect.tryPromise({
      try: async () => {
        try {
          return await readFile(path, "utf8");
        } catch (error) {
          if (isMissing(error)) return undefined;
          throw error;
        }
      },
      catch: (cause) => new JsonFileError({ path, message: describe(cause) }),
    }).pipe(
      Effect.flatMap((text) =>
        text === undefined
          ? Effect.succeed(initial)
          : decode(text).pipe(
              Effect.mapError((cause) => new JsonFileError({ path, message: cause.message })),
            ),
      ),
    ),
    write: (value) =>
      encode(value).pipe(
        Effect.mapError((cause) => new JsonFileError({ path, message: cause.message })),
        Effect.flatMap((text) =>
          Effect.tryPromise({
            try: async () => {
              await mkdir(dirname(path), { recursive: true });
              const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
              try {
                await writeFile(temporary, `${text}\n`, { encoding: "utf8", flag: "wx" });
                await rename(temporary, path);
              } catch (error) {
                await rm(temporary, { force: true }).catch(() => undefined);
                throw error;
              }
            },
            catch: (cause) => new JsonFileError({ path, message: describe(cause) }),
          }),
        ),
      ),
  };
};
