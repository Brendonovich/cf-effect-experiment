import { describe, expect, it, vi } from "vitest";

import { isApiPath, isCloudPath, route } from "./routing";

const worker = {
  fetch: (request: Request, env: Parameters<typeof route>[1]) =>
    route(request, env, async () => new Response("page")),
};

const binding = (name: string) => ({
  fetch: vi.fn(
    async (request: Request) => new Response(`${name} ${new URL(request.url).pathname}`),
  ),
});

describe("website Worker", () => {
  it("matches the paths the API and Cloud claim with Worker Routes", () => {
    for (const path of [
      "/api/website/session",
      "/api/oauth/token",
      "/auth/twitch/login",
      "/auth/proxy",
      "/.well-known/oauth-authorization-server",
    ])
      expect(isApiPath(path), path).toBe(true);
    for (const path of [
      "/",
      "/device",
      "/apis",
      "/authorize",
      "/.well-known/oauth-authorization-server/cloud",
    ])
      expect(isApiPath(path), path).toBe(false);
    for (const path of [
      "/cloud",
      "/cloud/",
      "/cloud/api/projects",
      "/.well-known/oauth-authorization-server/cloud",
      "/.well-known/oauth-protected-resource/cloud/api/mcp",
    ])
      expect(isCloudPath(path), path).toBe(true);
    expect(isCloudPath("/cloudy")).toBe(false);
  });

  it("forwards API and Cloud paths over their bindings and renders everything else", async () => {
    const env = { API: binding("api"), CLOUD: binding("cloud") };
    const text = async (url: string, init?: RequestInit) =>
      (await worker.fetch(new Request(url, init), env)).text();
    expect(await text("https://preview.example/api/website/session")).toBe(
      "api /api/website/session",
    );
    expect(await text("https://preview.example/.well-known/oauth-authorization-server/cloud")).toBe(
      "cloud /.well-known/oauth-authorization-server/cloud",
    );
    expect(await text("https://preview.example/cloud/projects")).toBe("cloud /cloud/projects");
    expect(await text("https://preview.example/device?user_code=X")).toBe("page");
  });

  it("redirects browsers from the legacy host, but never API calls", async () => {
    const env = { API: binding("api") };
    const page = await worker.fetch(new Request("https://www.macrograph.app/account?x=1"), env);
    expect(page.status).toBe(301);
    expect(page.headers.get("location")).toBe("https://macrograph.app/account?x=1");
    const api = await worker.fetch(
      new Request("https://www.macrograph.app/api/credentials", { method: "POST" }),
      env,
    );
    expect(await api.text()).toBe("api /api/credentials");
  });

  it("lets only visitors the API's preview gate allows reach pages and Cloud", async () => {
    const api = {
      fetch: vi.fn(async (request: Request) => {
        if (request.headers.get("x-macrograph-preview-gate") === null)
          return new Response(`api ${new URL(request.url).pathname}`);
        expect(request.body).toBeNull();
        expect(request.redirect).toBe("manual");
        return (request.headers.get("cookie") ?? "").includes("macrograph_preview=")
          ? new Response(null, { status: 204 })
          : Response.redirect("https://macrograph.app/auth/preview?origin=x", 302);
      }),
    };
    const env = { API: api, CLOUD: binding("cloud"), PREVIEW_GATE: "1" };
    const visit = (path: string, cookie = "") =>
      worker.fetch(new Request(`https://preview.example${path}`, { headers: { cookie } }), env);

    const outsider = await visit("/account");
    expect(outsider.status).toBe(302);
    expect(outsider.headers.get("location")).toContain("/auth/preview");
    expect((await visit("/cloud/")).status).toBe(302);
    // API paths are gated by the API itself, so they're forwarded untouched.
    expect(await (await visit("/auth/preview/callback?token=t")).text()).toBe(
      "api /auth/preview/callback",
    );

    expect(await (await visit("/account", "macrograph_preview=ok")).text()).toBe("page");
    expect(await (await visit("/cloud/", "macrograph_preview=ok")).text()).toBe("cloud /cloud/");
  });
});
