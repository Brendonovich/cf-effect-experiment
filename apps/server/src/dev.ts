import { ManagedRuntime } from "effect";

import { Main } from "./Server.ts";

const runtime = ManagedRuntime.make(Main);
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
