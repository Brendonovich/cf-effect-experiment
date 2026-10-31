// @vitest-environment jsdom

import { memoryHistory } from "@solidjs/router";
import { render } from "@solidjs/web";
import { QueryClient } from "@tanstack/solid-query";
import { afterEach, expect, it, vi } from "vitest";

import { App } from "./App";

const session = {
  user: { id: "user-1", email: "ada@example.com" },
  session: { id: "session-1" },
};

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
  return { container, history };
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
  const playground = container.querySelector<HTMLAnchorElement>('a[href="/playground/"]');
  expect(playground?.textContent).toBe("Playground");
  // The playground is a separate app, so the router must not handle the link.
  expect(playground?.rel).toBe("external");
});

it("sends signed-out visitors from account pages to login and back", async () => {
  mockApi({ "/api/website/session": null });
  const { history } = renderApp("/account/apps");
  await vi.waitFor(() =>
    expect(history.get()).toBe(`/login?next=${encodeURIComponent("/account/apps")}`),
  );
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
  expect(container.textContent).toContain("Use your connected credentials");

  const approve = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Approve",
  );
  approve?.click();
  await vi.waitFor(() => expect(container.textContent).toContain("Access granted"));
});
