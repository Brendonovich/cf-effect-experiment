# Filesystem

`ListFiles` and `ListFolders` return sorted entry names, not full paths, from a
directory on the runtime host. They are non-recursive and use the host's filesystem
permissions. Symbolic links are classified by their target. Missing, unreadable,
or invalid directories fail execution rather than returning an empty list.

The deployment requires Effect `FileSystem` and `Path` services. The self-hosted
server supplies these; this plugin is not mounted in browser or hosted runtimes.
