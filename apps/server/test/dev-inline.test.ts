import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNodeServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const appDirectory = resolve(import.meta.dirname, "..");
let server: ViteDevServer | undefined;
let dataDirectory = "";
let origin = "";
const basePath = "/macrograph";

beforeAll(async () => {
  const listener = createNodeServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (typeof address !== "object" || address === null) throw new Error("No listener address");
  await new Promise<void>((resolveClose) => listener.close(() => resolveClose()));

  dataDirectory = await mkdtemp(join(tmpdir(), "macrograph-dev-inline-"));
  for (const [key, value] of Object.entries({
    MACROGRAPH_DEV_BACKEND: "inline",
    PORT: String(address.port),
    HOST: "127.0.0.1",
    MACROGRAPH_DATA_DIR: dataDirectory,
    MACROGRAPH_BASE_PATH: basePath,
    OTEL_EXPORTER_OTLP_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
    // The dev server registers itself as the local channel's server under these.
    XDG_STATE_HOME: join(dataDirectory, "state"),
    XDG_CONFIG_HOME: join(dataDirectory, "config"),
    XDG_DATA_HOME: join(dataDirectory, "share"),
  })) {
    vi.stubEnv(key, value);
  }
  server = await createServer({
    configFile: join(appDirectory, "vite.config.ts"),
    cacheDir: join(dataDirectory, ".vite"),
    mode: "test",
    server: {
      port: 0,
      host: "127.0.0.1",
      watch: { ignored: ["**/project.db*"] },
    },
  });
  await server.listen();
  const viteAddress = server.httpServer?.address();
  if (typeof viteAddress !== "object" || viteAddress === null)
    throw new Error("No Vite listener address");
  origin = `http://127.0.0.1:${viteAddress.port}`;
}, 30_000);

const registrationPath = () => join(dataDirectory, "state", "macrograph", "service-local.json");

afterAll(async () => {
  await server?.close();
  await expect(stat(registrationPath())).rejects.toThrow();
  vi.unstubAllEnvs();
  if (dataDirectory !== "")
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// `pnpm dev:inline`: the backend runs inside Vite and hot-reloads with it.

it("serves the client and backend through one Vite server", async () => {
  const page = await fetch(`${origin}${basePath}/`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("/@vite/client");
  const client = await fetch(`${origin}${basePath}/src/index.tsx`);
  expect(client.status).toBe(200);
  expect(client.headers.get("content-type")).toContain("javascript");
  await client.text();
  const health = await fetch(`${origin}${basePath}/health/ready`);
  expect(await health.json()).toMatchObject({ status: "ok", ready: true });
  const session = await fetch(`${origin}${basePath}/auth/session`);
  expect(await session.json()).toEqual({
    user: null,
    canEdit: false,
    setupRequired: true,
    hasOwner: false,
  });
});

it("registers itself as the local channel's server at Vite's URL", async () => {
  const info = await vi.waitFor(
    async () =>
      JSON.parse(await readFile(registrationPath(), "utf8")) as {
        url: string;
        token: string;
        pid: number;
      },
    { timeout: 5_000 },
  );
  expect((await stat(registrationPath())).mode & 0o777).toBe(0o600);
  expect(info.pid).toBe(process.pid);
  expect(info.url).toBe(`${origin.replace("127.0.0.1", "localhost")}${basePath}`);
  const headers = { authorization: `Bearer ${info.token}` };
  const about = await fetch(`${info.url}/api/info`, { headers });
  expect(about.status).toBe(200);
  expect(await about.json()).toMatchObject({ pid: process.pid });
  const mcp = await fetch(`${info.url}/api/mcp`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(mcp.status).toBe(200);
  const listed = (await mcp.json()) as { result: { tools: ReadonlyArray<unknown> } };
  expect(listed.result.tools.length).toBeGreaterThan(0);
  expect((await fetch(`${info.url}/api/info`)).status).toBe(401);
});

it.each([
  ["server code", "src/Server.ts"],
  ["workspace dependencies", "../../packages/modules/utilities/src/Engine.ts"],
])("disposes WebSockets and reloads changes to %s", async (_, file) => {
  const registered = async () =>
    (JSON.parse(await readFile(registrationPath(), "utf8")) as { id: string }).id;
  const before = await vi.waitFor(registered, { timeout: 5_000 });
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}${basePath}/rpc-ws`);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
  });
  const closed = new Promise<void>((resolveClose) => {
    socket.addEventListener("close", () => resolveClose(), { once: true });
  });
  // Reloads overwrite the registration instead of removing it, so local clients never miss it.
  let watching = true;
  const missing: Array<unknown> = [];
  const watchRegistration = (async () => {
    while (watching) {
      await readFile(registrationPath(), "utf8").catch((error: unknown) => missing.push(error));
      await new Promise((resolveTick) => setTimeout(resolveTick, 5));
    }
  })();
  server!.watcher.emit("change", resolve(appDirectory, file));
  await closed;
  await vi.waitFor(
    async () => {
      const health = await fetch(`${origin}${basePath}/health/ready`);
      expect(await health.json()).toMatchObject({ status: "ok", ready: true });
    },
    { timeout: 15_000 },
  );
  // The reloaded server registers itself again.
  await vi.waitFor(async () => expect(await registered()).not.toBe(before), { timeout: 5_000 });
  watching = false;
  await watchRegistration;
  expect(missing).toEqual([]);
});

it("refuses to start while another server holds the local channel", async () => {
  const other = createHttpServer((_, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ version: "0.0.1", pid: process.pid + 1, setupUrl: null }));
  }).listen(0, "127.0.0.1");
  await once(other, "listening");
  const address = other.address();
  if (typeof address !== "object" || address === null) throw new Error("No listener address");
  const state = join(dataDirectory, "other-state");
  await mkdir(join(state, "macrograph"), { recursive: true });
  await writeFile(
    join(state, "macrograph", "service-local.json"),
    JSON.stringify({
      id: "daemon",
      version: "0.0.1",
      url: `http://127.0.0.1:${address.port}`,
      pid: process.pid + 1,
      token: "token",
      command: ["node", "index.mjs", "serve", "--service"],
    }),
  );
  vi.stubEnv("XDG_STATE_HOME", state);
  try {
    await expect(
      createServer({
        configFile: join(appDirectory, "vite.config.ts"),
        mode: "test",
        server: { port: 0 },
      }),
    ).rejects.toThrow("MACROGRAPH_CHANNEL=local macrograph service stop");
  } finally {
    vi.stubEnv("XDG_STATE_HOME", join(dataDirectory, "state"));
    await new Promise<void>((resolveClose) => other.close(() => resolveClose()));
  }
});
