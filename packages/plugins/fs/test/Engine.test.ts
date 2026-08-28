import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { DataType, Registration } from "@macrograph/plugin";
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

  it.effect("rejects invalid paths and exposes all four Electron nodes", () =>
    Effect.gen(function* () {
      const rpc = yield* makeRuntimeClient();
      for (const path of ["", "  ", "invalid\0path"]) {
        assert.isTrue(
          Result.isFailure(yield* Effect.result(rpc.FilesystemList({ path, kind: "File" }))),
        );
        assert.isTrue(Result.isFailure(yield* Effect.result(rpc.FilesystemReadText({ path }))));
      }
      const catalog = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        catalog.map((schema) => schema.id),
        ["ListFiles", "ListFolders", "ReadTextFile", "WriteTextFile"],
      );
      assert.deepStrictEqual(
        catalog.map((schema) => schema.dataOutputs[0]?.type),
        [
          { _tag: "List", item: { _tag: "String" } },
          { _tag: "List", item: { _tag: "String" } },
          { _tag: "String" },
          { _tag: "Bool" },
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reads and overwrites UTF-8 text only when writes are enabled", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();
      const file = path.join(directory, "text.txt");
      yield* fs.writeFileString(file, "original");
      const disabled = yield* makeRuntimeClient();
      const failure = yield* disabled
        .FilesystemWriteText({ path: file, text: "overwrite" })
        .pipe(Effect.flip);
      assert.include(failure.reason, "MACROGRAPH_ENABLE_FILE_WRITES=true");
      assert.strictEqual(yield* disabled.FilesystemReadText({ path: file }), "original");
      const enabled = yield* makeRuntimeClient(true);
      const text = "first line\n\u00e9\uD83D\uDE00";
      yield* enabled.FilesystemWriteText({ path: file, text });
      assert.strictEqual(yield* enabled.FilesystemReadText({ path: file }), text);
      yield* enabled.FilesystemWriteText({ path: file, text: "" });
      assert.strictEqual(yield* enabled.FilesystemReadText({ path: file }), "");
      const created = path.join(directory, "created.txt");
      yield* enabled.FilesystemWriteText({ path: created, text: "new" });
      assert.strictEqual(yield* enabled.FilesystemReadText({ path: created }), "new");
      for (const invalid of [
        "",
        "  ",
        "bad\0path",
        path.join(directory, "missing", "file.txt"),
        directory,
      ])
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(enabled.FilesystemWriteText({ path: invalid, text })),
          ),
        );
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(
            enabled.FilesystemReadText({ path: path.join(directory, "missing.txt") }),
          ),
        ),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "connects text-file schemas to their runtime RPCs and never reports failed writes as success",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped();
        const file = path.join(directory, "node.txt");
        const engine = yield* makeRuntimeClient(true);
        const catalog = yield* Registration.collect(plugin.effect);
        const outputs = new Map<string, unknown>();
        const run = (id: string, inputs: Readonly<Record<string, unknown>>) => {
          const schema = catalog.find((schema) => schema.id === id);
          assert.isDefined(schema);
          return schema.run({
            input: (ref) => (Object.hasOwn(inputs, ref.id) ? inputs[ref.id] : ref.defaultValue),
            output: (ref, value) => {
              assert.isTrue(DataType.isValue(ref.type, value), ref.id);
              outputs.set(ref.id, value);
            },
            properties: {},
            event: undefined,
            engine,
            execution: {
              projectId: "project",
              graphId: "graph",
              eventNodeId: "event",
              traceId: "execution",
            },
            node: {
              nodeId: "node",
              kind: "exec",
              executionPath: "event:event",
              traceId: "node",
              withSpan: (_name, effect) => effect,
            },
          });
        };
        yield* run("WriteTextFile", { file, text: "contents" });
        assert.strictEqual(outputs.get("success"), true);
        yield* run("ReadTextFile", { file });
        assert.strictEqual(outputs.get("textOut"), "contents");
        outputs.clear();
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(run("WriteTextFile", { file: directory, text: "contents" })),
          ),
        );
        assert.strictEqual(outputs.size, 0);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
