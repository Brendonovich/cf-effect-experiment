import { Effect, Layer, ManagedRuntime } from "effect";
import { fileURLToPath } from "node:url";
import sources from "virtual:macrograph-dev-modules";

import { DevModules } from "./DevModules.ts";
import { make } from "./Server.ts";
import { ServerConfig } from "./ServerConfig.ts";

const config = ServerConfig.makeServerConfig(process.env);
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
      make,
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
