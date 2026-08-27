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
  }),
});

export default FilesystemPlugin;
