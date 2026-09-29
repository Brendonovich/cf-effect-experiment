import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { FilesystemEngine } from "./Definition.ts";

const FilesystemModule = Module.make({
  id: "fs",
  name: "Filesystem",
  engine: FilesystemEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "ListFiles",
      name: "List Files",
      description: "Lists entry names in a folder on the runtime host, not the editor's computer.",
      io: (io) => ({
        path: io.data.in("path", t.String, { name: "Folder Path" }),
        entries: io.data.out("files", t.List(t.String), { name: "Files" }),
      }),
      run: ({ io, engine }) =>
        engine.FilesystemList({ path: io.path, kind: "File" }).pipe(
          Effect.tap((entries) => Effect.sync(() => io.entries(entries))),
          Effect.asVoid,
        ),
    });
    yield* context.schema.register({
      id: "ListFolders",
      name: "List Folders",
      description: "Lists entry names in a folder on the runtime host, not the editor's computer.",
      io: (io) => ({
        path: io.data.in("path", t.String, { name: "Folder Path" }),
        entries: io.data.out("folders", t.List(t.String), { name: "Folders" }),
      }),
      run: ({ io, engine }) =>
        engine.FilesystemList({ path: io.path, kind: "Directory" }).pipe(
          Effect.tap((entries) => Effect.sync(() => io.entries(entries))),
          Effect.asVoid,
        ),
    });
    yield* context.schema.register({
      id: "ReadTextFile",
      name: "Read Text File",
      description:
        "Reads a UTF-8 file on the runtime host. Invalid or unreadable files fail execution.",
      io: (io) => ({
        file: io.data.in("file", t.String, { name: "File Location" }),
        text: io.data.out("textOut", t.String, { name: "File Contents" }),
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
        file: io.data.in("file", t.String, { name: "File Location" }),
        text: io.data.in("text", t.String, { name: "Text to Write", defaultValue: "" }),
        success: io.data.out("success", t.Bool),
      }),
      run: ({ io, engine }) =>
        engine
          .FilesystemWriteText({ path: io.file, text: io.text })
          .pipe(Effect.tap(() => Effect.sync(() => io.success(true)))),
    });
  }),
});

export default FilesystemModule;
