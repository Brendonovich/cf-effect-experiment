import { pluginDeployments } from "@macrograph/plugin/vite";
import { fileURLToPath } from "node:url";
import {
  defineConfig,
  isRunnableDevEnvironment,
  loadEnv,
  mergeConfig,
  type UserConfig,
} from "vite";

import clientConfig, { serverPlugins } from "./client/vite.config.ts";
import { ServerConfig } from "./src/ServerConfig.ts";

export default defineConfig((env) => {
  for (const [key, value] of Object.entries(loadEnv(env.mode, import.meta.dirname, ""))) {
    process.env[key] ??= value;
  }
  process.env.MACROGRAPH_MIGRATIONS_DIR ??= fileURLToPath(
    new URL("../../packages/persistence-sqlite/drizzle", import.meta.url),
  );
  const config = ServerConfig.makeServerConfig(process.env);
  const client = clientConfig(env);
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
          { target: `http://localhost:${config.port}`, changeOrigin: true, ws: true },
        ]),
      ),
    },
    plugins: [
      pluginDeployments(undefined, serverPlugins),
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
