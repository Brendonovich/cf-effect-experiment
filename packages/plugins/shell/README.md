# Shell

`ExecuteShellCommand` runs a command through the runtime host's default shell,
waits for completion, and fails on nonzero exit or a 30-second timeout. Output is
discarded, matching the legacy node's lack of output pins. Scoped process cleanup
terminates the process on interruption, with forced termination after two seconds.

Shell execution is **disabled by default**. Set `MACROGRAPH_ENABLE_SHELL=true` on
the self-hosted server to enable it. It runs with the server's user, environment,
and working directory. Only enable this for trusted graph authors and never
interpolate untrusted event payloads into commands. This is not a sandbox and
does not guarantee termination of independently spawned descendant processes.

The deployment requires Effect's `ChildProcessSpawner` service and is not mounted
in browser or hosted runtimes.
