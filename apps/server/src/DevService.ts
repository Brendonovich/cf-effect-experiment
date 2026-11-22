import { Effect } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { watch, type RolldownWatcher } from "rolldown";

import { serverBuild } from "../rolldown.config.ts";
import { Channel } from "./Channel.ts";
import { ServiceClient } from "./ServiceClient.ts";
import { ServicePaths } from "./ServicePaths.ts";

/**
 * `pnpm dev`'s backend: the local channel's background service, run from a bundle of this source
 * that is rebuilt as the source changes. Vite only serves the client and proxies to it.
 *
 * Bundling is what lets the service run outside Vite: it resolves the module deployments virtual
 * module and the workspace's TypeScript packages exactly as release builds do. The bundle sits in
 * `node_modules/.cache`, so native addons resolve from this package's dependencies, and it carries
 * the migrations beside it, so the command it registers can restart it from anywhere.
 *
 * Several `pnpm dev` processes can run at once, each serving the client, all sharing the one
 * service. Only the process holding the owner lock builds, watches and restarts it; the others
 * check the lock every second and take over when its holder is gone.
 */

const appDirectory = fileURLToPath(new URL("..", import.meta.url));
export const outDirectory = join(appDirectory, "node_modules/.cache/macrograph-dev");
export const entry = join(outDirectory, "index.mjs");
const migrations = join(appDirectory, "../../packages/persistence-sqlite/drizzle");
const pollInterval = 1_000;

/** Runs the dev bundle's `serve --service` with this Node and source maps. */
export const command = () =>
  ServiceClient.selfCommand(["serve", "--service"], entry, ["--enable-source-maps"]);

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(FetchHttpClient.layer)));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
};

/** Identifies one `pnpm dev` process; `id` tells apart several in one process, as in tests. */
export interface Owner {
  readonly pid: number;
  readonly id: string;
}

/**
 * The owner lock for one service. Processes with other state directories run other services, so
 * they own those separately, while sharing the bundle, which is the same for all of them.
 */
export const ownerLock = (paths: ServicePaths) =>
  join(
    outDirectory,
    `owner-${createHash("sha256").update(paths.registration).digest("hex").slice(0, 12)}.json`,
  );

export const readOwner = (lock: string): Owner | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(lock, "utf8"));
    return typeof value === "object" &&
      value !== null &&
      "pid" in value &&
      typeof value.pid === "number" &&
      "id" in value &&
      typeof value.id === "string"
      ? { pid: value.pid, id: value.id }
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Takes the owner lock if it is free or its holder has exited. The lock is created whole with
 * `link`, so no one reads it half-written. Two processes replacing a dead holder at once can both
 * think they won; `readOwner` settles it on the next check, and the loser steps down.
 */
const acquire = (lock: string, self: Owner) => {
  mkdirSync(outDirectory, { recursive: true });
  const current = readOwner(lock);
  if (current?.id === self.id) return true;
  if (current !== undefined && alive(current.pid)) return false;
  if (current !== undefined || existsSync(lock)) rmSync(lock, { force: true });
  const temporary = `${lock}.${self.id}.tmp`;
  writeFileSync(temporary, JSON.stringify(self));
  try {
    linkSync(temporary, lock);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(temporary, { force: true });
  }
};

const release = (lock: string, self: Owner) => {
  if (readOwner(lock)?.id === self.id) rmSync(lock, { force: true });
};

/** Each owner builds beside the shared bundle, at the same depth so source maps still resolve. */
const stagingDirectory = (self: Owner) =>
  join(dirname(outDirectory), `macrograph-dev-build-${self.pid}-${self.id}`);

/** Removes the staging directories of processes that have exited. */
const removeStaleStaging = () => {
  for (const name of readdirSync(dirname(outDirectory))) {
    const pid = /^macrograph-dev-build-(\d+)-/.exec(name)?.[1];
    if (pid !== undefined && !alive(Number(pid)))
      rmSync(join(dirname(outDirectory), name), { recursive: true, force: true });
  }
};

/**
 * Moves a finished build into place with renames, so a service starting at the same time never
 * loads a partly written bundle. Returns whether the bundle changed.
 */
const publish = (staging: string) => {
  const built = join(staging, "index.mjs");
  const changed = !existsSync(entry) || !readFileSync(built).equals(readFileSync(entry));
  cpSync(migrations, join(outDirectory, "migrations"), { recursive: true });
  renameSync(`${built}.map`, `${entry}.map`);
  renameSync(built, entry);
  return changed;
};

export interface Logger {
  readonly info: (message: string) => void;
  readonly error: (message: string) => void;
}

export interface DevService {
  /** The service's registered URL, including the base path. */
  readonly url: string;
  readonly setupUrl: string | null;
  /** Reports each restart, for callers that rewrite the setup link. */
  readonly onRestart: (
    listener: (service: { url: string; setupUrl: string | null }) => void,
  ) => void;
  /** Stops watching and hands over ownership. The service keeps running for local clients. */
  readonly close: () => Promise<void>;
}

/**
 * Finds or starts the local channel's service from the source bundle. If no other `pnpm dev` owns
 * the backend, this one builds it, restarts a running service whose bundle changed, and restarts
 * the service on every later rebuild.
 */
export const start = async (log: Logger): Promise<DevService> => {
  const paths = ServicePaths.make(Channel.local);
  const current = await run(ServiceClient.status(paths));
  if (current?.health !== undefined && current.info.command === undefined)
    throw new Error(
      `\`pnpm dev:inline\` is serving the local channel (pid ${current.info.pid}). Stop it before running \`pnpm dev\`.`,
    );

  const self: Owner = { pid: process.pid, id: randomUUID() };
  const lock = ownerLock(paths);
  const staging = stagingDirectory(self);
  const listeners = new Set<(service: { url: string; setupUrl: string | null }) => void>();
  let watcher: RolldownWatcher | undefined;
  let restarting = Promise.resolve();
  let closed = false;

  const ensure = () => run(ServiceClient.ensure({ paths, command: command() }));

  const restart = () =>
    (restarting = restarting
      .then(async () => {
        log.info("Backend source changed; restarting the local MacroGraph server…");
        const { info, setupUrl } = await run(
          ServiceClient.stop(paths).pipe(
            Effect.andThen(ServiceClient.ensure({ paths, command: command() })),
          ),
        );
        log.info(`Local MacroGraph server restarted (pid ${info.pid})`);
        for (const listener of listeners) listener({ url: info.url, setupUrl });
      })
      .catch((error: unknown) =>
        log.error(
          `Could not restart the local MacroGraph server: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ));

  /**
   * Builds and watches the backend. Resolves after the first build, with whether it changed the
   * bundle: sources may have changed while nothing watched them.
   */
  const own = () =>
    new Promise<boolean>((resolve, reject) => {
      removeStaleStaging();
      const build = serverBuild(Channel.local);
      let initial = true;
      const owned = watch({
        ...build,
        cwd: appDirectory,
        output: {
          ...build.output,
          dir: staging,
          entryFileNames: "index.mjs",
          // One file, so a rebuild never removes chunks a running service has yet to load.
          codeSplitting: false,
          sourcemap: true,
        },
        watch: { buildDelay: 300 },
      });
      watcher = owned;
      owned.on("event", (event) => {
        if (event.code === "BUNDLE_END") {
          void event.result.close();
          const changed = publish(staging);
          if (initial) {
            initial = false;
            resolve(changed);
          } else void restart();
        } else if (event.code === "ERROR") {
          void event.result.close();
          // Without any bundle there is nothing to serve; otherwise keep watching for a fix.
          if (initial && !existsSync(entry)) {
            initial = false;
            reject(event.error);
            return;
          }
          log.error(
            `Backend build failed; the local server keeps running:\n${event.error.message}`,
          );
          if (initial) {
            initial = false;
            resolve(false);
          }
        }
      });
    });

  const disown = async () => {
    const owned = watcher;
    watcher = undefined;
    await owned?.close();
    rmSync(staging, { recursive: true, force: true });
  };

  let checking = false;
  /** Keeps ownership consistent with the lock: takes it over when free, gives it up when lost. */
  const check = async () => {
    if (checking || closed) return;
    checking = true;
    try {
      if (watcher === undefined) {
        if (!acquire(lock, self)) return;
        log.info("Took over building and watching the backend source");
        if (await own()) await restart();
        else await ensure();
      } else if (readOwner(lock)?.id !== self.id) {
        await disown();
        log.info(
          `Another \`pnpm dev\` (pid ${readOwner(lock)?.pid ?? "unknown"}) is now watching the backend source`,
        );
      }
    } catch (error) {
      await disown();
      release(lock, self);
      log.error(
        `Could not build the backend: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      checking = false;
    }
  };

  try {
    let service: { info: { url: string; pid: number }; setupUrl: string | null };
    if (acquire(lock, self)) {
      const changed = await own();
      service = await run(
        (changed && current?.health !== undefined ? ServiceClient.stop(paths) : Effect.void).pipe(
          Effect.andThen(ServiceClient.ensure({ paths, command: command() })),
        ),
      );
    } else {
      const owner = readOwner(lock);
      log.info(
        `Another \`pnpm dev\` (pid ${owner?.pid ?? "unknown"}) is building and watching the backend source; this one serves the client`,
      );
      // The owner may still be building the first bundle.
      const deadline = Date.now() + 120_000;
      while (!existsSync(entry) && Date.now() < deadline)
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      service = await ensure();
    }
    log.info(
      `Local MacroGraph server running from source (pid ${service.info.pid}) at ${service.info.url}`,
    );
    const timer = setInterval(() => void check(), pollInterval);
    timer.unref();
    return {
      url: service.info.url,
      setupUrl: service.setupUrl,
      onRestart: (listener) => void listeners.add(listener),
      close: async () => {
        closed = true;
        clearInterval(timer);
        await disown();
        release(lock, self);
      },
    };
  } catch (error) {
    closed = true;
    await disown();
    release(lock, self);
    throw error;
  }
};

export * as DevService from "./DevService.ts";
