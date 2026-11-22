import { homedir } from "node:os";
import { join } from "node:path";

import { Channel } from "./Channel.ts";

const xdg = (value: string | undefined, fallback: string) =>
  value === undefined || value === "" ? join(homedir(), fallback) : value;

/**
 * Per-user locations of a channel's background service, following the XDG base directory spec.
 * Channels never share files: `latest` uses `service.json` and `macrograph`, and every other
 * channel suffixes them, such as `service-local.json` and `macrograph-local`.
 */
export const make = (channel: string, env: NodeJS.ProcessEnv = process.env) => {
  const suffix = Channel.suffix(channel);
  return {
    channel,
    /** Describes the running service to its clients; deleted when it stops. */
    registration: join(
      xdg(env.XDG_STATE_HOME, ".local/state"),
      "macrograph",
      `service${suffix}.json`,
    ),
    /** Settings that outlive a single run of the service, such as its port and local token. */
    config: join(xdg(env.XDG_CONFIG_HOME, ".config"), "macrograph", `service${suffix}.json`),
    /** The project, credentials and sessions, unless `MACROGRAPH_DATA_DIR` says otherwise. */
    data: join(xdg(env.XDG_DATA_HOME, ".local/share"), `macrograph${suffix}`),
  };
};

export type ServicePaths = ReturnType<typeof make>;

export * as ServicePaths from "./ServicePaths.ts";
