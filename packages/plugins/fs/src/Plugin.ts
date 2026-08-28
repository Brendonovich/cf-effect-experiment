import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { FilesystemEngine } from "./Definition.ts";

const FilesystemPlugin = Plugin.make({
  id: "fs",
  name: "Filesystem",
  engine: FilesystemEngine,
  effect: Effect.fnUntraced(function* (context) {
    for (const kind of ["File", "Directory"] as const) {
      const files = kind === "File";
      yield* context.schema.register({
        id: files ? "ListFiles" : "ListFolders",
        name: files ? "List Files" : "List Folders",
        description:
          "Lists entry names in a folder on the runtime host, not the editor's computer.",
        io: (io) => ({
          path: io.data.in("path", DataType.String, { name: "Folder Path" }),
          entries: io.data.out(files ? "files" : "folders", DataType.List(DataType.String)),
        }),
        run: ({ io, engine }) =>
          engine.FilesystemList({ path: io.path, kind }).pipe(
            Effect.tap((entries) => Effect.sync(() => io.entries(entries))),
            Effect.asVoid,
          ),
      });
    }
    yield* context.schema.register({
      id: "ReadTextFile",
      name: "Read Text File",
      description:
        "Reads a UTF-8 file on the runtime host. Invalid or unreadable files fail execution.",
      io: (io) => ({
        file: io.data.in("file", DataType.String, { name: "File Location" }),
        text: io.data.out("textOut", DataType.String, { name: "File Contents" }),
      }),
      run: ({ io, engine }) =>
        engine.FilesystemReadText({ path: io.file }).pipe(
          Effect.tap((text) => Effect.sync(() => io.text(text))),
          Effect.asVoid,
        ),
    });
    yield* context.schema.register({
      id: "WriteTextFile",
      name: "Write Text File",
      description:
        "Creates or overwrites a UTF-8 file on the runtime host. Requires MACROGRAPH_ENABLE_FILE_WRITES=true. Failures stop execution; parent directories are not created.",
      io: (io) => ({
        file: io.data.in("file", DataType.String, { name: "File Location" }),
        text: io.data.in("text", DataType.String, { name: "Text to Write", defaultValue: "" }),
        success: io.data.out("success", DataType.Bool),
      }),
      run: ({ io, engine }) =>
        engine
          .FilesystemWriteText({ path: io.file, text: io.text })
          .pipe(Effect.tap(() => Effect.sync(() => io.success(true)))),
    });
  }),
});

export default FilesystemPlugin;
