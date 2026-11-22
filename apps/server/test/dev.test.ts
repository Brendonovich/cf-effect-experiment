import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createNodeServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { Channel } from "../src/Channel.ts";
import { DevService } from "../src/DevService.ts";
import { ServiceClient } from "../src/ServiceClient.ts";
import { ServicePaths } from "../src/ServicePaths.ts";

// `pnpm dev`: Vite serves the client and proxies to the local channel's service, built from source.

const appDirectory = resolve(import.meta.dirname, "..");
let server: ViteDevServer | undefined;
let dataDirectory = "";
let origin = "";
const basePath = "/macrograph";
const env = () => ({
  XDG_STATE_HOME: join(dataDirectory, "state"),
  XDG_CONFIG_HOME: join(dataDirectory, "config"),
  XDG_DATA_HOME: join(dataDirectory, "share"),
});
const paths = () => ServicePaths.make(Channel.local, env());

interface Registration {
  readonly url: string;
  readonly token: string;
  readonly pid: number;
  readonly command: ReadonlyArray<string>;
}
const registration = async () =>
  JSON.parse(await readFile(paths().registration, "utf8")) as Registration;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeAll(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "macrograph-dev-"));
  // Keep clear of a developer's own local service on the channel's default port.
  const listener = createNodeServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (typeof address !== "object" || address === null) throw new Error("No listener address");
  await new Promise<void>((resolveClose) => listener.close(() => resolveClose()));
  await mkdir(join(dataDirectory, "config", "macrograph"), { recursive: true });
  await writeFile(paths().config, JSON.stringify({ port: address.port }));

  for (const [key, value] of Object.entries({
    ...env(),
    MACROGRAPH_BASE_PATH: basePath,
    OTEL_EXPORTER_OTLP_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
  })) {
    vi.stubEnv(key, value);
  }
  server = await createServer({
    configFile: join(appDirectory, "vite.config.ts"),
    cacheDir: join(dataDirectory, ".vite"),
    mode: "test",
    server: { port: 0, host: "127.0.0.1" },
  });
  await server.listen();
  const viteAddress = server.httpServer?.address();
  if (typeof viteAddress !== "object" || viteAddress === null)
    throw new Error("No Vite listener address");
  origin = `http://127.0.0.1:${viteAddress.port}`;
}, 60_000);

afterAll(async () => {
  await server?.close();
  // Closing Vite, like interrupting `pnpm dev`, leaves the service running.
  const { pid } = await registration();
  expect(alive(pid)).toBe(true);
  await Effect.runPromise(ServiceClient.stop(paths()).pipe(Effect.provide(FetchHttpClient.layer)));
  expect(alive(pid)).toBe(false);
  await expect(stat(paths().registration)).rejects.toThrow();
  vi.unstubAllEnvs();
  await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}, 30_000);

it("runs the local channel's service from a bundle of the source", async () => {
  const info = await registration();
  expect((await stat(paths().registration)).mode & 0o777).toBe(0o600);
  expect(info.pid).not.toBe(process.pid);
  expect(alive(info.pid)).toBe(true);
  expect(info.command).toEqual(DevService.command());
  expect(info.command).toContain(DevService.entry);
  // The bundle is of the local channel, and the service keeps its data in the channel's directory.
  expect(await readFile(DevService.entry, "utf8")).toContain('const build = "local"');
  await expect(stat(join(paths().data, "project.db"))).resolves.toBeDefined();
});

it("serves the client itself and proxies the backend to the service", async () => {
  const page = await fetch(`${origin}${basePath}/`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("/@vite/client");
  const health = await fetch(`${origin}${basePath}/health/ready`);
  expect(await health.json()).toMatchObject({ status: "ok", ready: true });
  // The browser keeps its normal, unprivileged session.
  const session = await fetch(`${origin}${basePath}/auth/session`);
  expect(await session.json()).toMatchObject({ user: null, canEdit: false });

  const { token, pid } = await registration();
  const about = await fetch(`${origin}${basePath}/api/info`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(await about.json()).toMatchObject({ pid });

  const socket = new WebSocket(`${origin.replace("http:", "ws:")}${basePath}/rpc-ws`);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
  });
  socket.close();
});

it("lets a second `pnpm dev` share the service and take over watching when the first stops", async () => {
  const lock = DevService.ownerLock(paths());
  const first = DevService.readOwner(lock);
  const { pid } = await registration();
  expect(first).toBeDefined();

  const second = await createServer({
    configFile: join(appDirectory, "vite.config.ts"),
    cacheDir: join(dataDirectory, ".vite-second"),
    mode: "test",
    server: { port: 0, host: "127.0.0.1" },
  });
  await second.listen();
  const address = second.httpServer?.address();
  if (typeof address !== "object" || address === null) throw new Error("No Vite listener address");
  const secondOrigin = `http://127.0.0.1:${address.port}`;
  expect(secondOrigin).not.toBe(origin);
  expect(await (await fetch(`${secondOrigin}${basePath}/`)).text()).toContain("/@vite/client");
  const { token } = await registration();
  const about = await fetch(`${secondOrigin}${basePath}/api/info`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(await about.json()).toMatchObject({ pid });
  // The first keeps ownership, and starting the second restarted nothing.
  expect(DevService.readOwner(lock)).toEqual(first);
  expect((await registration()).pid).toBe(pid);

  await server?.close();
  server = second;
  await vi.waitFor(
    () => {
      const owner = DevService.readOwner(lock);
      expect(owner).toBeDefined();
      expect(owner?.id).not.toBe(first?.id);
    },
    { timeout: 5_000 },
  );
  // The bundle had not changed, so taking over did not restart the service either.
  expect((await registration()).pid).toBe(pid);
  expect(alive(pid)).toBe(true);
}, 60_000);
