# Filesystem

`ListFiles` and `ListFolders` return sorted entry names, not full paths, from a
directory on the runtime host. They are non-recursive and use the host's filesystem
permissions. Symbolic links are classified by their target. Missing, unreadable,
or invalid directories fail execution rather than returning an empty list.

`ReadTextFile` reads UTF-8 text. `WriteTextFile` creates or overwrites a UTF-8 file
and outputs `success: true` after completion. Parent directories must already
exist. Unlike the Electron implementation, read/write failures stop execution
rather than outputting error text or silently reporting a failed write.

Writes are disabled by default. Set `MACROGRAPH_ENABLE_FILE_WRITES=true` on the
runtime host to enable them. This is not a sandbox: trusted graph authors can
overwrite any file accessible to the server, including through symbolic links.
Reads also use the server's full filesystem permissions. Do not expose these
nodes to untrusted graph authors.

The deployment requires Effect `FileSystem` and `Path` services. The self-hosted
server supplies these; this plugin is not mounted in browser or hosted runtimes.
