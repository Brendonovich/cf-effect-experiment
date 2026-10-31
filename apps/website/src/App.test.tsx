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
  expect(container.textContent).not.toContain("Playground");
});

it("sends signed-out visitors from account pages to login and back", async () => {
  mockApi({ "/api/website/session": null });
  const { history } = renderApp("/account/servers");
  await vi.waitFor(() =>
    expect(history.get()).toBe(`/login?next=${encodeURIComponent("/account/servers")}`),
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

it("shows a not-found page for removed playground routes", async () => {
  mockApi({ "/api/website/session": null });
  const { container } = renderApp("/playground");
  await vi.waitFor(() => expect(container.textContent).toContain("Page not found"));
});

it("switches account tabs without reloading", async () => {
  mockApi({
    "/api/website/session": session,
    "/api/website/credentials": [],
    "/api/website/servers": [{ id: "server-1", type: "server" }],
  });
  const { container, history } = renderApp("/account/credentials");
  const heading = () => container.querySelector("h1")?.textContent;
  await vi.waitFor(() => expect(heading()).toBe("Credentials"));

  const tab = (href: string) => container.querySelector<HTMLAnchorElement>(`nav a[href="${href}"]`);

  tab("/account/servers")?.click();
  await vi.waitFor(() => expect(heading()).toBe("Servers"));
  expect(history.get()).toBe("/account/servers");
  tab("/account/credentials")?.click();
  await vi.waitFor(() => expect(heading()).toBe("Credentials"));
});
