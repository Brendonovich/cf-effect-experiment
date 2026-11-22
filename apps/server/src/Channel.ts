import { createHash } from "node:crypto";

// Replaced by the bundler; unbuilt code (Vite dev, tests) has no build channel.
declare const MACROGRAPH_CHANNEL: string | undefined;

/** The channel of the running code: the build's, or `local` when it runs unbuilt. */
export const build = typeof MACROGRAPH_CHANNEL === "string" ? MACROGRAPH_CHANNEL : "local";

/** The channel of released builds, which owns the unsuffixed service files. */
export const latest = "latest";
/** The channel of `pnpm dev`, whose service runs from source and is only started by it. */
export const local = "local";

/** The channel to use: `MACROGRAPH_CHANNEL` at runtime, falling back to the build's. */
export const current = (env: NodeJS.ProcessEnv = process.env) => {
  const value = env.MACROGRAPH_CHANNEL?.trim();
  return value === undefined || value === "" ? build : value;
};

/** A channel name that is safe in file names. */
export const sanitize = (channel: string) => channel.replace(/[^a-zA-Z0-9._-]/g, "-");

/** Appended to the channel's file and directory names; empty for `latest`. */
export const suffix = (channel: string) => (channel === latest ? "" : `-${sanitize(channel)}`);

/**
 * The background service's default port. Other channels get a stable port in 20000-29999, below
 * the ephemeral ranges operating systems hand out for outgoing connections.
 */
export const defaultPort = (channel: string) =>
  channel === latest
    ? 3170
    : channel === local
      ? 3171
      : 20_000 +
        (Number.parseInt(createHash("sha256").update(channel).digest("hex").slice(0, 8), 16) %
          10_000);

/** The command that connects an MCP client to a channel's server. */
export const mcpCommand = (channel: string) =>
  channel === latest ? "macrograph mcp" : `MACROGRAPH_CHANNEL=${channel} macrograph mcp`;

export * as Channel from "./Channel.ts";
