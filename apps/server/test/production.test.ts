import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appDirectory = resolve(import.meta.dirname, "..");
let child: ChildProcess;
let origin = "";
let dataDirectory = "";
const basePath = "/macrograph";
let setupKey = "";
let approved = false;
const cloud = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  const path = request.url?.split("?")[0];
  if (path === "/server/registration/start") {
    response.end(
      JSON.stringify({
        id: "setup-registration",
        userCode: "SETUP",
        verification_uri: "https://www.macrograph.app/connect",
        verification_uri_complete: "https://www.macrograph.app/connect?code=SETUP",
      }),
    );
  } else if (path === "/server/registration" && request.method === "POST") {
    response.statusCode = approved ? 200 : 400;
    response.end(
      JSON.stringify(
        approved
          ? { token: "cloud-registration-token" }
          : { _tag: "ServerRegistrationError", code: "authorization_pending" },
      ),
    );
  } else if (path === "/server/registration") {
    response.end(JSON.stringify({ ownerId: "setup-owner" }));
  } else if (path === "/user") {
    const id = request.headers.authorization === "Bearer reader-token" ? "reader" : "setup-owner";
    response.end(JSON.stringify({ id, email: `${id}@example.com` }));
  } else if (path === "/login/oauth/access_token") {
    response.end(
      JSON.stringify({
        userId: "reader",
        access_token: "reader-token",
        refresh_token: "refresh",
        token_type: "Bearer",
      }),
    );
  } else if (path === "/credentials") {
    response.end("[]");
  } else {
    response.statusCode = 404;
    response.end("{}");
  }
});

const rawStatus = (path: string) =>
  new Promise<number>((resolveStatus, reject) => {
    const target = new URL(origin);
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolveStatus(response.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end();
  });

beforeAll(async () => {
  await readFile(join(appDirectory, "dist/esm/index.js"));
  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const cloudAddress = cloud.address();
  if (cloudAddress === null || typeof cloudAddress === "string")
    throw new Error("No cloud address");
  dataDirectory = await mkdtemp(join(tmpdir(), "macrograph-production-"));
  child = spawn(process.execPath, ["dist/esm/index.js"], {
    cwd: appDirectory,
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      MACROGRAPH_DATA_DIR: dataDirectory,
      MACROGRAPH_BASE_PATH: basePath,
      MACROGRAPH_CLOUD_BASE_URL: `http://127.0.0.1:${cloudAddress.port}`,
      MACROGRAPH_ADMIN_IDS: "",
      OTEL_EXPORTER_OTLP_ENDPOINT: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 15_000);
    child.once("exit", (code) => reject(new Error(`Server exited with ${code}: ${output}`)));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /MACROGRAPH_LISTENING (\d+)/.exec(output);
      setupKey = /MACROGRAPH_SETUP_KEY ([\w-]+)/.exec(output)?.[1] ?? "";
      if (match?.[1] !== undefined && setupKey !== "") {
        clearTimeout(timeout);
        resolvePort(Number(match[1]));
      }
    });
  });
  origin = `http://127.0.0.1:${port}`;
}, 20_000);

afterAll(async () => {
  child?.kill("SIGTERM");
  await new Promise<void>((resolveExit, reject) => {
    if (child?.exitCode !== null) return resolveExit();
    const timeout = setTimeout(() => reject(new Error("Server did not stop")), 15_000);
    child?.once("exit", () => resolveExit());
    child?.once("exit", () => clearTimeout(timeout));
  });
  if (dataDirectory !== "") await rm(dataDirectory, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) =>
    cloud.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("built self-hosted server", () => {
  it("serves distinct health checks, the SPA, and immutable assets", async () => {
    const live = await fetch(`${origin}${basePath}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });

    const health = await fetch(`${origin}${basePath}/health/ready`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", ready: true });
    expect(health.headers.get("cache-control")).toBe("no-store");

    const index = await fetch(`${origin}${basePath}/`);
    const html = await index.text();
    expect(index.status).toBe(200);
    expect(index.headers.get("cache-control")).toBe("no-cache");
    expect(index.headers.get("content-type")).toContain("text/html");
    const assetPath = /(?:src|href)="([^"]*\/assets\/[^"]+)"/.exec(html)?.[1];
    expect(assetPath).toBeDefined();
    if (assetPath === undefined) throw new Error("Built index has no asset URL");
    const asset = await fetch(new URL(assetPath, origin));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(asset.headers.get("content-type")).not.toBe("application/octet-stream");
    const range = await fetch(new URL(assetPath, origin), { headers: { range: "bytes=0-9" } });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toMatch(/^bytes 0-9\/\d+$/);

    const head = await fetch(new URL(assetPath, origin), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const etag = asset.headers.get("etag");
    expect(etag).not.toBeNull();
    if (etag === null) throw new Error("Built asset has no ETag");
    const unchanged = await fetch(new URL(assetPath, origin), {
      headers: { "if-none-match": etag },
    });
    expect(unchanged.status).toBe(304);
  });

  it("falls back only for browser routes and rejects traversal", async () => {
    const spa = await fetch(`${origin}${basePath}/editor`, {
      headers: { accept: "text/html" },
    });
    expect(spa.status).toBe(200);
    expect(spa.headers.get("content-type")).toContain("text/html");
    expect((await fetch(`${origin}${basePath}/rpc/not-an-api`)).status).toBe(404);
    expect((await fetch(`${origin}${basePath}/api/not-an-api`)).status).toBe(404);
    expect((await fetch(`${origin}${basePath}/editor`, { method: "POST" })).status).toBe(404);
    expect(await rawStatus(`${basePath}/%2e%2e/package.json`)).toBe(400);
    expect(await rawStatus(`${basePath}/assets/%2eenv`)).toBe(400);
    expect(await rawStatus(`${basePath}/r%70c/not-an-api`)).toBe(404);
    expect((await fetch(`${origin}/editor`)).status).toBe(404);
  });

  it("includes self-hosted client authentication without the hosted cloud session", async () => {
    const assets = join(appDirectory, "dist/client/assets");
    const scripts = (await readdir(assets)).filter((file) => file.endsWith(".js"));
    const source = (
      await Promise.all(scripts.map((file) => readFile(join(assets, file), "utf8")))
    ).join("\n");
    expect(source).toContain("macrograph:self-hosted:session");
    expect(source).not.toContain("macrograph:sessionId");
    expect(source).not.toContain("cloudflare-mainworker");
  });

  it("starts anonymous sessions as read-only", async () => {
    const response = await fetch(`${origin}${basePath}/auth/session`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ user: null, canEdit: false, setupRequired: true });
  });

  it("requires the private setup key for registration start and polling", async () => {
    expect(setupKey).toMatch(/^[\w-]{43}$/);
    for (const operation of ["start", "poll"]) {
      const invalid = await fetch(`${origin}${basePath}/auth/setup/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "incorrect" }),
      });
      expect(invalid.status).toBe(403);
      expect(invalid.headers.get("cache-control")).toBe("no-store");
      expect(await invalid.json()).toEqual({ error: "Invalid setup key" });

      const missing = await fetch(`${origin}${basePath}/auth/setup/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(missing.status).toBe(400);
    }
  });

  it("rejects inherited-property session tokens at the HTTP plugin gate", async () => {
    for (const token of ["constructor", "toString", "__proto__"]) {
      const response = await fetch(`${origin}${basePath}/plugin/twitch/rpc`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(403);
    }
  });

  it("accepts an editor WebSocket connection", async () => {
    const websocket = new WebSocket(`${origin.replace("http:", "ws:")}${basePath}/rpc-ws`);
    await new Promise<void>((resolveOpen, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket did not open")), 5_000);
      websocket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolveOpen();
      });
      websocket.addEventListener("error", () => reject(new Error("WebSocket failed")));
    });
    websocket.close();
  });

  it("routes plugin RPCs over the editor WebSocket", async () => {
    const websocket = new WebSocket(`${origin.replace("http:", "ws:")}${basePath}/rpc-ws`);
    const response = new Promise<{ readonly id?: number; readonly error?: unknown }>(
      (resolveResponse, reject) => {
        const timeout = setTimeout(() => reject(new Error("Plugin RPC did not respond")), 5_000);
        websocket.addEventListener("open", () => {
          const payload = new TextEncoder().encode(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "ToggleEventSubSubscription",
              params: {
                accountId: "test-account",
                subscriptionType: "channel.ban",
                enabled: true,
              },
              id: 1,
            }),
          );
          const frame = new Uint8Array(payload.length + 1);
          frame[0] = 0;
          frame.set(payload, 1);
          websocket.send(frame);
        });
        websocket.addEventListener("message", (event) => {
          void (
            event.data instanceof Blob
              ? event.data.arrayBuffer().then((buffer) => new Uint8Array(buffer))
              : Promise.resolve(new Uint8Array(event.data as ArrayBuffer))
          ).then((bytes) => {
            if (bytes[0] !== 0) return;
            clearTimeout(timeout);
            resolveResponse(JSON.parse(new TextDecoder().decode(bytes.subarray(1))));
          });
        });
        websocket.addEventListener("error", () => reject(new Error("WebSocket failed")));
      },
    );

    const message = await response;
    expect(message.id).toBe(1);
    expect(message.error).toBeDefined();
    websocket.close();
  });

  it("claims the server, connects credentials, and remembers only the approved admin session", async () => {
    const setupRequest = (operation: string) =>
      fetch(`${origin}${basePath}/auth/setup/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: setupKey }),
      });
    const started = await setupRequest("start");
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ state: "pending" });
    expect(await (await setupRequest("poll")).json()).toMatchObject({ state: "pending" });
    approved = true;
    const completed = await setupRequest("poll");
    expect(completed.status).toBe(200);
    expect(completed.headers.get("cache-control")).toBe("no-store");
    const result = (await completed.json()) as { state: string; token: string };
    expect(result.state).toBe("connected");
    expect(result.token).toMatch(/^[\w-]{43}$/);
    const session = await fetch(`${origin}${basePath}/auth/session`, {
      headers: { authorization: `Bearer ${result.token}` },
    });
    expect(await session.json()).toEqual({
      user: { userId: "setup-owner", email: "setup-owner@example.com" },
      canEdit: true,
      setupRequired: false,
    });
    expect(
      JSON.parse(await readFile(join(dataDirectory, "macrograph-owner.json"), "utf8")),
    ).toEqual({ ownerId: "setup-owner" });
    expect(
      JSON.parse(await readFile(join(dataDirectory, "macrograph-auth.json"), "utf8")),
    ).toMatchObject({
      state: "connected",
      userId: "setup-owner",
      token: "cloud-registration-token",
    });
    expect((await setupRequest("start")).status).toBe(403);
    expect((await setupRequest("poll")).status).toBe(403);

    const reader = await fetch(`${origin}${basePath}/auth/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: "reader-device" }),
    });
    const readerSession = (await reader.json()) as { token: string };
    const readerStatus = await fetch(`${origin}${basePath}/auth/session`, {
      headers: { authorization: `Bearer ${readerSession.token}` },
    });
    expect(await readerStatus.json()).toEqual({
      user: { userId: "reader", email: "reader@example.com" },
      canEdit: false,
      setupRequired: false,
    });
  });

  it("stops idempotently with an active WebSocket", async () => {
    const websocket = new WebSocket(`${origin.replace("http:", "ws:")}${basePath}/rpc-ws`);
    await new Promise<void>((resolveOpen, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket did not open")), 5_000);
      websocket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolveOpen();
      });
      websocket.addEventListener("error", () => reject(new Error("WebSocket failed")));
    });

    child.kill("SIGTERM");
    child.kill("SIGINT");
    const code = await new Promise<number | null>((resolveExit, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server did not stop")), 15_000);
      child.once("exit", (exitCode) => {
        clearTimeout(timeout);
        resolveExit(exitCode);
      });
    });
    expect([0, 130, 143]).toContain(code);
    expect(websocket.readyState).toBe(WebSocket.CLOSED);
  }, 20_000);
});
