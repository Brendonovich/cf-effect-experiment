// @vitest-environment jsdom

import { memoryHistory } from "@solidjs/router";
import { render } from "@solidjs/web";
import { QueryClient } from "@tanstack/solid-query";
import { afterEach, expect, it, vi } from "vitest";

import { App } from "./App";

const session = {
  user: { id: "user-1", email: "ada@example.com", hasSignInMethod: true },
  session: { id: "session-1" },
};

const signInProviders = [
  { id: "twitch", displayName: "Twitch" },
  { id: "github", displayName: "GitHub" },
];

const mockApi = (routes: Record<string, unknown>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.origin === "http://localhost:25000") throw new TypeError("Desktop not running");
      return url.pathname in routes
        ? Response.json(routes[url.pathname])
        : new Response(null, { status: 404 });
    }),
  );

const renderApp = (path: string) => {
  const history = memoryHistory(path);
  const container = document.createElement("div");
  document.body.append(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const dispose = render(() => <App history={history} queryClient={queryClient} />, container);
  cleanups.push(() => {
    dispose();
    container.remove();
  });
  return { container, history, queryClient };
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});

it("renders the landing page with a login link for signed-out visitors", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/");
  await vi.waitFor(() => expect(container.textContent).toContain("Log in"));
  expect(container.querySelector("h1")?.textContent).toBe("MacroGraph");
  expect(container.textContent).toContain("Visual programming for streamers");
  expect(container.querySelector('main a[href="/playground"]')?.textContent).toBe("Playground");
});

it("links landing page integrations to their package reference", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/");
  await vi.waitFor(() => expect(container.textContent).toContain("Integrations"));
  expect(container.querySelector('a[href="/modules/macrograph/twitch"]')?.textContent).toBe(
    "Twitch",
  );
  expect(container.querySelector('main a[href="/modules"]')?.textContent).toContain(
    "Browse all modules",
  );
});

it("links the landing page to the server setup guide", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/");
  await vi.waitFor(() => expect(container.textContent).toContain("Download Desktop"));
  expect(container.querySelector('main a[href="/docs/server"]')?.textContent).toBe("Setup Server");
});

it("renders the server setup guide", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/docs/server");
  await vi.waitFor(() =>
    expect(container.querySelector("h1")?.textContent).toBe("Set up a server"),
  );
  expect(container.textContent).toContain("ghcr.io/brendonovich/macrograph-server:beta");
});

it("steps through the server setup guide", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/docs/server");
  await vi.waitFor(() =>
    expect(container.querySelector("h1")?.textContent).toBe("Set up a server"),
  );
  const expanded = () =>
    container.querySelector('button[aria-expanded="true"]')?.textContent?.replace(/^\d/, "");
  expect(expanded()).toBe("Start the container");
  const next = [...container.querySelectorAll("button")].find((b) => b.textContent === "Next");
  next?.click();
  await vi.waitFor(() => expect(expanded()).toBe("Open your setup link"));
  expect(container.textContent).toContain("docker logs macrograph");
  const claim = [...container.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-expanded") !== null && b.textContent?.includes("Claim your server"),
  );
  claim?.click();
  await vi.waitFor(() => expect(container.textContent).toContain("Step 3 of 4"));
  const currentPart = () =>
    container.querySelector('button[aria-current="step"]')?.textContent ?? "";
  expect(currentPart()).toContain("Continue with MacroGraph");
  const approvePart = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("choose Approve"),
  );
  approvePart?.click();
  await vi.waitFor(() => expect(currentPart()).toContain("choose Approve"));
});

it("links guides from the docs sidebar", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/docs/server");
  await vi.waitFor(() => expect(container.querySelector('nav[aria-label="Docs"]')).not.toBeNull());
  const sidebar = container.querySelector('nav[aria-label="Docs"]');
  expect(sidebar?.textContent).toContain("Guides");
  expect(sidebar?.textContent).not.toContain("Modules");
  // Narrower screens open the same links in a drawer, from a bar that shows where you are.
  const menu = container.querySelector('button[aria-controls="docs-drawer"]');
  expect(menu?.getAttribute("aria-label")).toBe("Open navigation");
  expect(menu?.parentElement?.textContent).toBe("GuidesSet up a server");
  expect(sidebar?.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
    "/docs/server",
  );
});

it("gives modules their own section, outside the docs", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/modules/macrograph/string");
  await vi.waitFor(() => expect(container.textContent).toContain("Overview"));
  expect(container.querySelector('nav[aria-label="Docs"]')).toBeNull();
  expect(
    container.querySelector('header a[href="/modules"]')?.getAttribute("aria-current"),
  ).toBeNull();
});

it("lists a package's nodes and shows one at a time", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/modules/macrograph/string/StringIncludes");
  await vi.waitFor(() =>
    expect(container.querySelector("[data-graph-node-id]")?.textContent).toContain(
      "String Includes",
    ),
  );
  expect(container.querySelectorAll("[data-graph-node-id]")).toHaveLength(1);
  expect(container.textContent).toContain("Performs a case-sensitive literal string comparison.");
  const link = container.querySelector('a[href="/modules/macrograph/string/StringLength"]');
  expect(link?.textContent).toBe("String Length");
  expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe("String Includes");
});

it("shows node properties with their controls", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/modules/macrograph/obs/GetSceneItemTransform");
  await vi.waitFor(() => expect(container.textContent).toContain("Properties"));
  expect(container.textContent).toContain("OBS Socket");
});

it("shows a not-found message for unknown packages and nodes", async () => {
  mockApi({ "/api/website/session": null });
  const unknownPackage = renderApp("/modules/macrograph/nope");
  await vi.waitFor(() =>
    expect(unknownPackage.container.textContent).toContain("Module not found"),
  );
  const unknownNode = renderApp("/modules/macrograph/string/Nope");
  await vi.waitFor(() => expect(unknownNode.container.textContent).toContain("Node not found"));
});

it("sends signed-out visitors from account pages to login and back", async () => {
  mockApi({ "/api/website/session": null });
  const { history } = renderApp("/account/apps");
  await vi.waitFor(() =>
    expect(history.get()).toBe(`/login?next=${encodeURIComponent("/account/apps")}`),
  );
});

it("offers provider sign-in and explains why one failed", async () => {
  mockApi({
    "/api/website/session": null,
    "/api/website/sign-in/providers": signInProviders,
  });
  const { container } = renderApp("/login?next=%2Fcloud&error=account_exists");
  await vi.waitFor(() => expect(container.textContent).toContain("Continue with Twitch"));
  const twitch = container.querySelector<HTMLAnchorElement>(
    'a[href^="/api/website/sign-in/twitch"]',
  );
  // The provider returns to this page without the old error, which then continues to `next`.
  expect(new URL(twitch?.href ?? "", "http://localhost").searchParams.get("returnTo")).toBe(
    "/login?next=%2Fcloud",
  );
  expect(twitch?.rel).toBe("external");
  expect(container.textContent).toContain("Continue with GitHub");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "already uses that email",
  );
  // Email and password stays available for existing accounts, but out of the way.
  expect(container.querySelector('input[type="password"]')).toBeNull();
});

it("sends signups to the login page", async () => {
  mockApi({ "/api/website/session": null, "/api/website/sign-in/providers": signInProviders });
  const { history } = renderApp("/signup?next=%2Fcloud");
  await vi.waitFor(() => expect(history.get()).toBe("/login?next=%2Fcloud"));
});

it("makes password-only accounts connect a sign-in method first", async () => {
  mockApi({
    "/api/website/session": { ...session, user: { ...session.user, hasSignInMethod: false } },
    "/api/website/sign-in/providers": signInProviders,
  });
  const { container, history } = renderApp("/account/credentials");
  await vi.waitFor(() =>
    expect(container.querySelector("h1")?.textContent).toBe("Connect a sign-in method"),
  );
  expect(history.get()).toBe(`/login?next=${encodeURIComponent("/account/credentials")}`);
  expect(container.textContent).toContain("ada@example.com");
  const github = container.querySelector<HTMLAnchorElement>(
    'a[href^="/api/website/sign-in/github"]',
  );
  expect(github?.textContent).toBe("Connect GitHub");
});

it("lists sign-in methods and keeps the last one", async () => {
  mockApi({
    "/api/website/session": session,
    "/api/website/sign-in/providers": signInProviders,
    "/api/website/sign-in-methods": [
      {
        providerId: "twitch",
        providerUserId: "1001",
        displayName: "ada",
        email: "ada@example.com",
      },
    ],
  });
  const { container } = renderApp("/account/sign-in");
  await vi.waitFor(() => expect(container.textContent).toContain("ada@example.com"));
  expect(container.querySelector("h1")?.textContent).toBe("Sign-in methods");
  const remove = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Remove",
  );
  expect(remove?.disabled).toBe(true);
  await vi.waitFor(() => expect(container.textContent).toContain("Connect GitHub"));
});

it("lists credentials grouped by provider for signed-in users", async () => {
  mockApi({
    "/api/website/session": session,
    "/api/website/credentials": [
      { providerId: "twitch", providerUserId: "41245072", displayName: "Ada Streams" },
      { providerId: "twitch", providerUserId: "88123004", displayName: "AdaBot" },
    ],
  });
  const { container } = renderApp("/credentials");
  await vi.waitFor(() => expect(container.textContent).toContain("Connected"));
  expect(container.textContent).toContain("Twitch");
  // Discord has no accounts, so it is offered under Available.
  expect(container.textContent).toContain("Discord");
  expect(container.textContent).not.toContain("Status");
});

it("renders the playground inside the site", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/playground");
  await vi.waitFor(() =>
    expect(container.querySelector("header")?.textContent).toContain("Log in"),
  );
  expect(container.textContent).not.toContain("Page not found");
});

it("switches account tabs without reloading", async () => {
  mockApi({
    "/api/website/session": session,
    "/api/website/credentials": [],
    "/api/website/authorizations": [
      {
        id: "grant-1",
        client: { id: "mgc_1", name: "Ada's server", verified: false },
        scope: ["openid", "offline_access", "credentials"],
        createdAt: 0,
        lastUsedAt: 0,
      },
    ],
  });
  const { container, history } = renderApp("/account/credentials");
  const heading = () => container.querySelector("h1")?.textContent;
  await vi.waitFor(() => expect(heading()).toBe("Credentials"));

  const tab = (href: string) => container.querySelector<HTMLAnchorElement>(`nav a[href="${href}"]`);

  tab("/account/apps")?.click();
  await vi.waitFor(() => expect(heading()).toBe("Apps"));
  await vi.waitFor(() => expect(container.textContent).toContain("Ada's server"));
  expect(history.get()).toBe("/account/apps");
  tab("/account/credentials")?.click();
  await vi.waitFor(() => expect(heading()).toBe("Credentials"));
});

it("approves a device sign-in after showing who is asking and for what", async () => {
  mockApi({
    "/api/website/session": session,
    "/api/website/device/lookup": {
      userCode: "BCDF-GHJK",
      client: { id: "mgc_1", name: "Ada's server", verified: false },
      scope: ["openid", "email", "offline_access", "credentials"],
      requestedAt: 0,
      expiresAt: 0,
      requestIp: "203.0.113.7",
      requestCountry: "NZ",
    },
    "/api/website/device/approve": true,
  });
  const { container, history } = renderApp("/device?user_code=BCDF-GHJK");
  await vi.waitFor(() => expect(container.textContent).toContain("Approve sign-in?"));
  // The code is read once and kept out of history.
  expect(history.get()).toBe("/device");
  expect(container.textContent).toContain("BCDF-GHJK");
  expect(container.textContent).toContain("Ada's server");
  expect(container.textContent).toContain("Unverified");
  expect(container.textContent).toContain("203.0.113.7");
  expect(container.textContent).toContain("Use your connected accounts");
  expect(container.textContent).toContain("Only approve servers you trust");

  const approve = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Approve",
  );
  approve?.click();
  await vi.waitFor(() => expect(container.textContent).toContain("Access granted"));
});

it("keeps a linked device code when the session refetches", async () => {
  mockApi({
    "/api/website/session": session,
    "/api/website/device/lookup": {
      userCode: "BCDF-GHJK",
      client: { id: "mgc_1", name: "Ada's server", verified: true },
      scope: ["openid"],
      requestedAt: 0,
      expiresAt: 0,
      requestIp: null,
      requestCountry: null,
    },
  });
  const { container, history, queryClient } = renderApp("/device?user_code=BCDF-GHJK");
  await vi.waitFor(() => expect(container.textContent).toContain("Approve sign-in?"));
  await vi.waitFor(() => expect(history.get()).toBe("/device"));

  // Returning to the tab after the session goes stale refetches it.
  await queryClient.refetchQueries({ queryKey: ["session"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(container.textContent).toContain("Approve sign-in?");
  expect(container.textContent).toContain("BCDF-GHJK");
});
