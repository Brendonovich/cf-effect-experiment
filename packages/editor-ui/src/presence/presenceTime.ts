import type { Presence } from "@macrograph/editor";

import { createEffect, createSignal } from "solid-js";

/** A short description of how long ago a client was last active, e.g. "12s ago". */
export const formatLastActive = (elapsedMs: number) => {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

const fadeFraction = 1 / 3;
const minOpacity = 0.4;

/**
 * Opacity for a client: entries held by a live connection stay opaque, while touched entries
 * fade over the last third of their lifetime so it is clear they are about to disappear.
 */
export const presenceOpacity = (
  client: Pick<Presence.Client, "lastActiveAt" | "expiresAt">,
  now: number,
) => {
  if (client.expiresAt === null) return 1;
  const lifetime = client.expiresAt - client.lastActiveAt;
  if (lifetime <= 0) return minOpacity;
  const remaining = (client.expiresAt - now) / lifetime;
  if (remaining >= fadeFraction) return 1;
  return minOpacity + (1 - minOpacity) * Math.max(0, remaining / fadeFraction);
};

/** The current time, ticking every `intervalMs` while `active` is true. */
export function createNow(active: () => boolean, intervalMs = 1000) {
  const [now, setNow] = createSignal(Date.now());
  createEffect(active, (isActive) => {
    if (!isActive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  });
  return now;
}
