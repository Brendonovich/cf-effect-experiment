import { Effect, Layer, ManagedRuntime } from "effect";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import sources from "virtual:macrograph-dev-modules";

import { Channel } from "./Channel.ts";
import { DevModules } from "./DevModules.ts";
import { LocalAccess } from "./LocalAccess.ts";
import { make } from "./Server.ts";
import { ServerConfig } from "./ServerConfig.ts";
import { ServiceConfig } from "./ServiceConfig.ts";
import { ServicePaths } from "./ServicePaths.ts";
import { ServiceRegistration } from "./ServiceRegistration.ts";
import { version } from "./Version.ts";

const config = ServerConfig.makeServerConfig(process.env);
const paths = ServicePaths.make(Channel.local);

// Vite's server environment is an ES module, so top-level await is available here.
const { token } = await Effect.runPromise(
  ServiceConfig.loadWithToken(paths.config).pipe(Effect.orDie),
);

const runtime = ManagedRuntime.make(
  Layer.unwrap(
    Effect.map(
      DevModules.options({
        sources,
        directory: fileURLToPath(
          new URL("../node_modules/.macrograph/dev-modules", import.meta.url),
        ),
        basePath: config.basePath,
      }),
      (options) =>
        make({
          ...options,
          local: LocalAccess.make(token),
          // Vite owns the public port and proxies to this listener, so agents connect through it.
          onListen: () =>
            ServiceRegistration.write(paths.registration, {
              id: randomUUID(),
              version,
              url: `${config.publicOrigin}${config.basePath}`,
              pid: process.pid,
              token,
            }).pipe(Effect.andThen(Effect.logInfo(`MCP: ${Channel.mcpCommand(Channel.local)}`))),
        }),
    ),
  ),
);
let disposal: Promise<void> | undefined;
const dispose = () => (disposal ??= runtime.dispose());

// Keep Vite's shutdown callback pointed at the current runtime across HMR updates.
const lifecycle: { stop?: () => Promise<void> } = import.meta.hot?.data ?? {};
lifecycle.stop = dispose;
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
