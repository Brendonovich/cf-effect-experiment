import type { AddressInfo } from "node:net";

import { moduleDeployments } from "@macrograph/module/vite";
import clientConfig, { serverModules } from "@macrograph/server-client/vite-config";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import {
  defineConfig,
  isRunnableDevEnvironment,
  loadEnv,
  mergeConfig,
  type ConfigEnv,
  type UserConfig,
  type ViteDevServer,
} from "vite";

import { Channel } from "./src/Channel.ts";
import { DevService } from "./src/DevService.ts";
import { ServerConfig } from "./src/ServerConfig.ts";
import { ServiceClient } from "./src/ServiceClient.ts";
import { ServicePaths } from "./src/ServicePaths.ts";

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

/** Vite's origin as clients should use it, once it is listening. */
const listeningOrigin = (server: ViteDevServer, listener: (origin: string) => void) =>
  server.httpServer?.once("listening", () => {
    const address = server.httpServer?.address();
    if (typeof address !== "object" || address === null) return;
    listener(`http://${hostFor(address)}:${address.port}`);
  });

const hostFor = (address: AddressInfo) =>
  ["127.0.0.1", "::1", "0.0.0.0", "::"].includes(address.address)
    ? "localhost"
    : address.family === "IPv6"
      ? `[${address.address}]`
      : address.address;

const log = (message: string) => console.info(`[macrograph] ${message}`);

const proxyTo = (client: UserConfig, target: string) =>
  Object.fromEntries(
    Object.keys(client.server?.proxy ?? {}).map((path) => [
      path,
      { target, changeOrigin: true, ws: true },
    ]),
  );

/**
 * `pnpm dev`: Vite serves and hot-reloads only the client, and proxies the backend's routes to the
 * local channel's background service, which runs from source and restarts when it changes. The
 * browser keeps its normal session; only local clients use the channel's token.
 */
const serviceConfig = async (client: UserConfig): Promise<UserConfig> => {
  const service = await DevService.start({
    info: log,
    error: (message) => console.error(`[macrograph] ${message}`),
  });
  let origin: string | undefined;
  const announceSetup = (setupUrl: string | null) => {
    if (setupUrl === null || origin === undefined) return;
    const url = new URL(setupUrl);
    log(`Set up the local server at ${origin}${url.pathname}${url.hash}`);
  };
  return mergeConfig(client, {
    root: fileURLToPath(new URL("./client", import.meta.url)),
    server: {
      // Several `pnpm dev` processes can share the service, each on the next free port.
      strictPort: false,
      proxy: proxyTo(client, new URL(service.url).origin),
    },
    plugins: [
      {
        name: "macrograph-dev-service",
        apply: "serve",
        configureServer(server) {
          // Interrupting `pnpm dev` leaves the service running for local clients.
          server.httpServer?.once("close", () => void service.close());
          listeningOrigin(server, (listening) => {
            origin = listening;
            log(`MCP: ${Channel.mcpCommand(Channel.local)}`);
            announceSetup(service.setupUrl);
          });
          service.onRestart(({ setupUrl }) => announceSetup(setupUrl));
        },
      },
    ],
  } satisfies UserConfig);
};

/**
 * `pnpm dev:inline`: the backend runs inside Vite's server environment, hot-reloading with it,
 * behind a private loopback port that Vite proxies to. It registers Vite's URL as the local
 * channel's server, so it refuses to start while another server holds the channel.
 */
const inlineConfig = async (client: UserConfig): Promise<UserConfig> => {
  const paths = ServicePaths.make(Channel.local);
  const current = await Effect.runPromise(
    ServiceClient.status(paths).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  if (current?.health !== undefined && current.health.pid !== process.pid)
    throw new Error(
      `A local MacroGraph server is already running at ${current.info.url} (pid ${current.health.pid}). ` +
        "Stop it with `MACROGRAPH_CHANNEL=local macrograph service stop`, or use `pnpm dev`.",
    );
  process.env.MACROGRAPH_MIGRATIONS_DIR ??= fileURLToPath(
    new URL("../../packages/persistence-sqlite/drizzle", import.meta.url),
  );
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
    server: { proxy: proxyTo(client, `http://${config.host}:${config.port}`) },
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
          // Clients of the local channel reach the backend through Vite's proxy, at Vite's URL.
          listeningOrigin(server, app.setPublicOrigin);
        },
        async closeBundle() {
          if (this.environment.name === "server") await stop?.();
        },
      },
    ],
  } satisfies UserConfig);
};

export default defineConfig(async (env: ConfigEnv) => {
  for (const [key, value] of Object.entries(loadEnv(env.mode, import.meta.dirname, ""))) {
    process.env[key] ??= value;
  }
  const client = mergeConfig(clientConfig(env), {
    // Speculative client transforms can leave Vite waiting indefinitely during shutdown.
    server: { preTransformRequests: false },
  } satisfies UserConfig);
  return process.env.MACROGRAPH_DEV_BACKEND === "inline"
    ? inlineConfig(client)
    : serviceConfig(client);
});
