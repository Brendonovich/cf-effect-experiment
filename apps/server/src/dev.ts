import { Effect, Layer, ManagedRuntime } from "effect";
import { randomUUID } from "node:crypto";

import { Channel } from "./Channel.ts";
import { LocalAccess } from "./LocalAccess.ts";
import { layer } from "./Server.ts";
import { ServerConfig } from "./ServerConfig.ts";
import { ServiceConfig } from "./ServiceConfig.ts";
import { ServicePaths } from "./ServicePaths.ts";
import { ServiceRegistration } from "./ServiceRegistration.ts";
import { version } from "./Version.ts";

/**
 * `pnpm dev:inline`: the backend runs inside Vite's server environment and hot-reloads with it.
 * This module is that backend's entrypoint, re-run by Vite on every backend change.
 */

/** Survives HMR updates, so a reloaded module knows Vite's URL and how Vite stops the server. */
interface Lifecycle {
  stop?: () => Promise<void>;
  /** Vite's own origin, which proxies the backend and is what clients should use. */
  publicOrigin?: string;
  waiting?: Set<(origin: string) => void>;
  announced?: boolean;
  /** The registration this process last wrote. */
  registered?: ServiceRegistration.Info;
}
const lifecycle: Lifecycle = import.meta.hot?.data ?? {};

/** Called by the Vite config once Vite is listening. */
export const setPublicOrigin = (origin: string) => {
  lifecycle.publicOrigin = origin;
  for (const resume of lifecycle.waiting ?? []) resume(origin);
  lifecycle.waiting?.clear();
};

const publicOrigin = Effect.callback<string>((resume) => {
  if (lifecycle.publicOrigin !== undefined) return resume(Effect.succeed(lifecycle.publicOrigin));
  const waiter = (origin: string) => resume(Effect.succeed(origin));
  (lifecycle.waiting ??= new Set()).add(waiter);
  return Effect.sync(() => lifecycle.waiting?.delete(waiter));
});

const paths = ServicePaths.make(Channel.local);

/**
 * The local channel's server: it accepts the channel's local token and registers Vite's URL in
 * `service-local.json`. Each reload overwrites the registration atomically instead of removing it,
 * so clients never find it missing; it is only removed when Vite stops. If the process is killed,
 * the file stays behind and clients see that its PID no longer answers. Data stays where
 * `MACROGRAPH_DATA_DIR` (or the working directory) says.
 */
const DevServer = Layer.unwrap(
  Effect.gen(function* () {
    const { token } = yield* ServiceConfig.loadWithToken(paths.config).pipe(Effect.orDie);
    const config = ServerConfig.makeServerConfig(process.env);
    return layer({
      config,
      local: LocalAccess.make(token),
      announce: (line) => console.log(line),
      onListen: () =>
        // Vite listens only after this module has first loaded, so register once it does.
        publicOrigin.pipe(
          Effect.flatMap((origin) => {
            const info: ServiceRegistration.Info = {
              id: randomUUID(),
              version,
              url: `${origin}${config.basePath}`,
              pid: process.pid,
              token,
            };
            return ServiceRegistration.write(paths.registration, info).pipe(
              Effect.andThen(Effect.sync(() => (lifecycle.registered = info))),
            );
          }),
          Effect.andThen(
            Effect.sync(() => {
              if (lifecycle.announced) return;
              lifecycle.announced = true;
              console.info(`MCP: ${Channel.mcpCommand(Channel.local)}`);
            }),
          ),
          Effect.forkScoped,
          Effect.asVoid,
        ),
    });
  }),
);

const runtime = ManagedRuntime.make(DevServer);
let disposal: Promise<void> | undefined;
const dispose = () => (disposal ??= runtime.dispose());

// Keep Vite's shutdown callback pointed at the current runtime across HMR updates.
lifecycle.stop = async () => {
  await dispose();
  const registered = lifecycle.registered;
  if (registered !== undefined)
    await Effect.runPromise(ServiceRegistration.removeIfOwned(paths.registration, registered));
};
export const stop = () => lifecycle.stop?.();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(dispose);
  import.meta.hot.on("vite:beforeFullReload", dispose);
}

await runtime.context().catch(async (error) => {
  await dispose();
  throw error;
});
