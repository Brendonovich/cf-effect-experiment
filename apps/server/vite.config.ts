import { moduleDeployments } from "@macrograph/module/vite";
import clientConfig, { serverModules } from "@macrograph/server-client/vite-config";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import {
  defineConfig,
  isRunnableDevEnvironment,
  loadEnv,
  mergeConfig,
  type UserConfig,
} from "vite";

import { ServerConfig } from "./src/ServerConfig.ts";

/** Asks the OS for a free loopback port. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("Could not find a free port")),
      );
    });
  });

export default defineConfig(async (env) => {
  for (const [key, value] of Object.entries(loadEnv(env.mode, import.meta.dirname, ""))) {
    process.env[key] ??= value;
  }
  process.env.MACROGRAPH_MIGRATIONS_DIR ??= fileURLToPath(
    new URL("../../packages/persistence-sqlite/drizzle", import.meta.url),
  );
  const client = clientConfig(env);
  // Vite's port is the only public one: the backend listens on a private loopback port that
  // Vite proxies to, and links it prints point at Vite.
  process.env.PORT = String(await freePort());
  process.env.HOST = "127.0.0.1";
  process.env.MACROGRAPH_BEHIND_DEV_PROXY = "1";
  process.env.MACROGRAPH_PUBLIC_ORIGIN ??= `http://localhost:${client.server?.port}`;
  const config = ServerConfig.makeServerConfig(process.env);
  let stop: (() => Promise<void> | undefined) | undefined;

  return mergeConfig(client, {
    root: fileURLToPath(new URL("./client", import.meta.url)),
    environments: {
      server: { consumer: "server" },
    },
    server: {
      // Speculative client transforms can leave Vite waiting indefinitely during shutdown.
      preTransformRequests: false,
      proxy: Object.fromEntries(
        Object.keys(client.server?.proxy ?? {}).map((path) => [
          path,
          { target: `http://${config.host}:${config.port}`, changeOrigin: true, ws: true },
        ]),
      ),
    },
    plugins: [
      moduleDeployments(undefined, serverModules),
      {
        name: "macrograph-dev-server",
        apply: "serve",
        async configureServer(server) {
          const environment = server.environments.server;
          if (!environment || !isRunnableDevEnvironment(environment))
            throw new Error("Server environment is not runnable");
          const app = await environment.runner.import<typeof import("./src/dev.ts")>(
            fileURLToPath(new URL("./src/dev.ts", import.meta.url)),
          );
          stop = app.stop;
        },
        async closeBundle() {
          if (this.environment.name === "server") await stop?.();
        },
      },
    ],
  } satisfies UserConfig);
});
