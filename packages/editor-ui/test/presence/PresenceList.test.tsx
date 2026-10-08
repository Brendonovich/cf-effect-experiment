// @vitest-environment jsdom
import type { Presence } from "@macrograph/editor";

import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

import { PresenceList } from "../../src/presence/PresenceList";

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

const client = (overrides: Partial<Presence.Client> & { id: string }): Presence.Client => ({
  kind: "browser",
  userId: null,
  displayName: overrides.id,
  email: null,
  color: "#22c55e",
  canEdit: true,
  activeGraph: null,
  cursor: null,
  viewport: null,
  selectedNodeIds: [],
  remote: null,
  lastActiveAt: 0,
  expiresAt: null,
  ...overrides,
});

it("lists other people, not you or what they're viewing, and toggles following", () => {
  const follow = vi.fn();
  const onFollow = vi.fn();
  const [followingId, setFollowingId] = createSignal<string | null>(null);
  const clients = [
    client({ id: "self", userId: "me", displayName: "me", email: "me@example.com" }),
    client({
      id: "ada-tab",
      userId: "ada",
      displayName: "ada",
      activeGraph: "main",
      lastActiveAt: 9,
    }),
    client({ id: "mcp:ada", kind: "mcp", userId: "ada", displayName: "", lastActiveAt: 5 }),
    client({ id: "viewer", displayName: "Quiet Moth", canEdit: false }),
    client({ id: "x", displayName: "xavier" }),
    client({ id: "y", displayName: "yuki" }),
  ];

  dispose = render(
    () => (
      <PresenceList
        controller={{
          connection: { presenceClients: () => clients, selfId: () => "self" },
          follow: {
            followingId,
            follow: (id: string) => {
              follow(id);
              setFollowingId(id);
            },
            stop: () => setFollowingId(null),
          },
        }}
        onFollow={onFollow}
        max={3}
      />
    ),
    document.body,
  );
  flush();

  const trigger = document.querySelector<HTMLButtonElement>("[data-presence-trigger]")!;
  expect(trigger.getAttribute("aria-label")).toBe("4 people connected");
  expect(trigger.querySelectorAll("[data-avatar-variant]")).toHaveLength(3);
  expect(trigger.textContent).toContain("+1");

  trigger.click();
  flush();
  const groups = [...document.querySelectorAll("[data-presence-group]")];
  expect(groups.map((group) => group.getAttribute("data-presence-group"))).toEqual([
    "user:ada",
    "client:viewer",
    "client:x",
    "client:y",
  ]);
  expect(document.body.textContent).not.toContain("(you)");
  expect(document.body.textContent).not.toContain("Main");
  // Browser tabs are the person themselves; only agents get rows of their own.
  expect(groups[0]!.querySelector('[data-presence-kind="browser"]')).toBeNull();
  expect(groups[0]!.querySelector('[data-presence-kind="mcp"]')).not.toBeNull();
  expect(groups[1]!.textContent).toContain("Read only");

  groups[0]!.querySelector<HTMLButtonElement>("[data-presence-person]")!.click();
  flush();
  expect(follow).toHaveBeenCalledWith("ada-tab");
  expect(onFollow).toHaveBeenCalledOnce();
  expect(
    trigger
      .querySelector('[data-presence-stack="user:ada"]')!
      .hasAttribute("data-presence-following"),
  ).toBe(true);

  trigger.click();
  flush();
  const person = document.querySelector<HTMLButtonElement>(
    '[data-presence-group="user:ada"] [data-presence-person]',
  )!;
  expect(person.getAttribute("aria-pressed")).toBe("true");
  expect(person.textContent).toContain("Following");
  person.click();
  flush();
  expect(followingId()).toBeNull();
});

it("shows remote clients under their user and follows them", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  try {
    const follow = vi.fn();
    const [followingId] = createSignal<string | null>(null);
    const remote = (name: string, version: string | null, apiKeyName: string) => ({
      name,
      version,
      apiKeyName,
    });
    const clients = [
      client({ id: "self", userId: "me", displayName: "me" }),
      client({
        id: "mcp:session",
        kind: "mcp",
        userId: "ada",
        displayName: "ada",
        email: "ada@example.com",
        activeGraph: "main",
        remote: remote("Claude Desktop", "1.2.3", "Laptop"),
        lastActiveAt: 88_000,
        expiresAt: 178_000,
      }),
      client({
        id: "api:key",
        kind: "api",
        userId: "ada",
        displayName: "ada",
        email: "ada@example.com",
        remote: remote("CI deploy key", null, "CI deploy key"),
        lastActiveAt: 30_000,
        expiresAt: 120_000,
      }),
    ];

    dispose = render(
      () => (
        <PresenceList
          controller={{
            connection: { presenceClients: () => clients, selfId: () => "self" },
            follow: { followingId, follow, stop: () => {} },
          }}
        />
      ),
      document.body,
    );
    flush();

    // A person with only agents still appears, with a badge for their agent.
    const trigger = document.querySelector<HTMLButtonElement>("[data-presence-trigger]")!;
    expect(trigger.getAttribute("aria-label")).toBe("1 person connected");
    const stack = trigger.querySelector('[data-presence-stack="user:ada"]')!;
    expect(
      stack.querySelector("[data-presence-agent-badge]")?.getAttribute("data-presence-agent-badge"),
    ).toBe("mcp");
    expect(stack.getAttribute("title")).toBe("ada · Claude Desktop (MCP) · CI deploy key (API)");

    trigger.click();
    flush();
    const group = document.querySelector('[data-presence-group="user:ada"]')!;
    const agent = group.querySelector<HTMLElement>('[data-presence-client="mcp:session"]')!;
    expect(agent.querySelector("[data-presence-client-name]")!.textContent).toBe("Claude Desktop");
    expect(agent.textContent).toContain("MCP");
    expect(agent.textContent).not.toContain("Main");
    expect(agent.title).toBe('Claude Desktop 1.2.3 · MCP · key "Laptop"');
    expect(agent.style.opacity).toBe("1");
    const api = group.querySelector<HTMLElement>('[data-presence-client="api:key"]')!;
    expect(api.querySelector("[data-presence-client-name]")!.textContent).toBe("CI deploy key");
    expect(api.textContent).toContain("API");
    // Within the last third of its lifetime the entry fades out.
    expect(Number(api.style.opacity)).toBeLessThan(1);

    agent.click();
    expect(follow).toHaveBeenCalledWith("mcp:session");
  } finally {
    vi.useRealTimers();
  }
});

it("renders nothing when you are alone", () => {
  const [followingId] = createSignal<string | null>(null);
  dispose = render(
    () => (
      <PresenceList
        controller={{
          connection: {
            presenceClients: () => [client({ id: "self", userId: "me", displayName: "me" })],
            selfId: () => "self",
          },
          follow: { followingId, follow: () => {}, stop: () => {} },
        }}
      />
    ),
    document.body,
  );
  flush();
  expect(document.querySelector("[data-presence-trigger]")).toBeNull();
});
