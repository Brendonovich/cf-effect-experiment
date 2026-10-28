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
  if (dataDirectory !== "")
    await rm(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
  expect(await session.json()).toEqual({
    user: null,
    canEdit: false,
    setupRequired: true,
    hasOwner: false,
  });
});

it("loads built-ins from source and points their UI at Vite-served sources", async () => {
  const response = await fetch(`${origin}${basePath}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "GetModules", params: {} }),
  });
  const { result } = (await response.json()) as {
    readonly result: ReadonlyArray<{
      readonly id: string;
      readonly status: string;
      readonly source: string;
      readonly ui?: { readonly entryUrl: string };
    }>;
  };
  const utilities = result.find((entry) => entry.id === "macrograph.app/macrograph/utilities");
  expect(utilities).toMatchObject({ status: "loaded", source: "shipped" });
  expect(utilities?.ui?.entryUrl).toMatch(
    new RegExp(`^${basePath}/@fs/.*/packages/modules/utilities/src/UI\\.ts$`),
  );
  const ui = await fetch(`${origin}${utilities?.ui?.entryUrl}`);
  expect(ui.status).toBe(200);
  expect(ui.headers.get("content-type")).toContain("javascript");
  expect(await ui.text()).toContain("ModuleUI");
});

it("loads MIDI's native addon from source through its own dependency", async () => {
  const response = await fetch(`${origin}${basePath}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "GetModuleClientState",
      params: { moduleId: "macrograph.app/macrograph/midi" },
    }),
  });
  const { result } = (await response.json()) as {
    readonly result?: { readonly available: boolean; readonly error?: string };
  };
  expect(result?.error).toBeUndefined();
  expect(result?.available).toBe(true);
});

it.each([
  ["server code", "src/Server.ts"],
  ["workspace dependencies", "../../packages/modules/utilities/src/Engine.ts"],
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
