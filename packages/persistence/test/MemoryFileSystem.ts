import { Effect, FileSystem, Layer, PlatformError, Ref } from "effect";

const systemError = (method: string, path: string) =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
  });

export const layerMemory: Layer.Layer<FileSystem.FileSystem> = Layer.unwrap(
  Effect.gen(function* () {
    const files = yield* Ref.make(new Map<string, string>());
    const dirs = yield* Ref.make(new Set<string>());

    return FileSystem.layerNoop({
      makeDirectory: (path) =>
        Ref.update(dirs, (set) => {
          const parts = path.split("/").filter(Boolean);
          const next = new Set(set);
          for (let i = 1; i <= parts.length; i++) {
            next.add("/" + parts.slice(0, i).join("/"));
          }
          return next;
        }),

      writeFileString: (path, content) =>
        Ref.update(files, (map) => new Map(map).set(path, content)),

      readFileString: (path) =>
        Ref.get(files).pipe(
          Effect.flatMap((map) => {
            const content = map.get(path);
            return content
              ? Effect.succeed(content)
              : Effect.fail(systemError("readFileString", path));
          }),
        ),

      exists: (path) =>
        Effect.zipWith(Ref.get(files), Ref.get(dirs), (f, d) => f.has(path) || d.has(path)),

      readDirectory: (path) =>
        Effect.zipWith(Ref.get(files), Ref.get(dirs), (f, d) => {
          const prefix = path === "/" ? path : path + "/";
          const entries = new Set<string>();
          for (const key of f.keys()) {
            if (key.startsWith(prefix)) {
              const rest = key.slice(prefix.length);
              const first = rest.split("/")[0];
              if (first) entries.add(first);
            }
          }
          for (const key of d.keys()) {
            if (key.startsWith(prefix)) {
              const rest = key.slice(prefix.length);
              const first = rest.split("/")[0];
              if (first) entries.add(first);
            }
          }
          return [...entries];
        }),

      remove: (path, options) =>
        Effect.gen(function* () {
          if (options?.recursive) {
            yield* Ref.update(files, (map) => {
              const next = new Map(map);
              for (const key of map.keys()) {
                if (key === path || key.startsWith(path + "/")) next.delete(key);
              }
              return next;
            });
            yield* Ref.update(dirs, (set) => {
              const next = new Set(set);
              for (const key of set) {
                if (key === path || key.startsWith(path + "/")) next.delete(key);
              }
              return next;
            });
          } else {
            yield* Ref.update(files, (map) => {
              const next = new Map(map);
              next.delete(path);
              return next;
            });
            yield* Ref.update(dirs, (set) => {
              const next = new Set(set);
              next.delete(path);
              return next;
            });
          }
        }),
    });
  }),
);

export * as MemoryFileSystem from "./MemoryFileSystem";
