import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
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

  dataDirectory = await mkdtemp(join(tmpdir(), "macrograph-dev-"));
  for (const [key, value] of Object.entries({
    PORT: String(address.port),
    HOST: "127.0.0.1",
    MACROGRAPH_DATA_DIR: dataDirectory,
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

afterAll(async () => {
  await server?.close();
  vi.unstubAllEnvs();
  if (dataDirectory !== "") await rm(dataDirectory, { recursive: true, force: true });
});

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
  expect(await session.json()).toEqual({ user: null, canEdit: false, setupRequired: true });
});

it.each([
  ["server code", "src/Server.ts"],
  ["workspace dependencies", "../../packages/plugins/utilities/src/Engine.ts"],
])("disposes WebSockets and reloads changes to %s", async (_, file) => {
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}${basePath}/rpc-ws`);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
  });
  const closed = new Promise<void>((resolveClose) => {
    socket.addEventListener("close", () => resolveClose(), { once: true });
  });
  server!.watcher.emit("change", resolve(appDirectory, file));
  await closed;
  await vi.waitFor(
    async () => {
      const health = await fetch(`${origin}${basePath}/health/ready`);
      expect(await health.json()).toMatchObject({ status: "ok", ready: true });
    },
    { timeout: 15_000 },
  );
});
