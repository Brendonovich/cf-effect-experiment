import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, FileSystem, Path, Result } from "effect";

import { makeRuntimeClient } from "../src/Engine.ts";
import plugin from "../src/Plugin.ts";

describe("Filesystem", () => {
  it.effect("lists sorted file and folder names without traversing subfolders", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(path.join(directory, "z.txt"), "z");
      yield* fs.writeFileString(path.join(directory, "a.txt"), "a");
      yield* fs.makeDirectory(path.join(directory, "nested"));
      yield* fs.writeFileString(path.join(directory, "nested", "hidden.txt"), "hidden");
      const rpc = yield* makeRuntimeClient();
      assert.deepStrictEqual(yield* rpc.FilesystemList({ path: directory, kind: "File" }), [
        "a.txt",
        "z.txt",
      ]);
      assert.deepStrictEqual(yield* rpc.FilesystemList({ path: directory, kind: "Directory" }), [
        "nested",
      ]);
      assert.deepStrictEqual(
        yield* rpc.FilesystemList({ path: path.join(directory, "nested"), kind: "Directory" }),
        [],
      );
      const missing = yield* Effect.result(
        rpc.FilesystemList({ path: path.join(directory, "missing"), kind: "File" }),
      );
      assert.isTrue(Result.isFailure(missing));
      if (Result.isFailure(missing))
        assert.strictEqual(missing.failure.reason, "Unable to list the directory");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects invalid paths and exposes both legacy nodes", () =>
    Effect.gen(function* () {
      const rpc = yield* makeRuntimeClient();
      for (const path of ["", "  ", "invalid\0path"])
        assert.isTrue(
          Result.isFailure(yield* Effect.result(rpc.FilesystemList({ path, kind: "File" }))),
        );
      const catalog = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        catalog.map((schema) => schema.id),
        ["ListFiles", "ListFolders"],
      );
      assert.deepStrictEqual(
        catalog.map((schema) => schema.dataOutputs[0]?.type),
        [
          { _tag: "List", item: { _tag: "String" } },
          { _tag: "List", item: { _tag: "String" } },
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
