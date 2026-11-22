import { Duration, Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import type { ServicePaths } from "./ServicePaths.ts";

import { Channel } from "./Channel.ts";
import { ServiceRegistration } from "./ServiceRegistration.ts";
import { version } from "./Version.ts";

export class ServiceError extends Schema.TaggedError<ServiceError>()("ServiceError", {
  message: Schema.String,
}) {}

export interface Endpoint {
  readonly url: string;
  readonly token: string;
}

export interface Health {
  /** `starting` while the service is bound but still building the app. */
  readonly state: "ready" | "starting";
  readonly version: string;
  readonly pid: number;
  /** Where to claim the server, while it has no owner. */
  readonly setupUrl: string | null;
}

const InfoResponse = Schema.Struct({
  version: Schema.String,
  pid: Schema.Int,
  setupUrl: Schema.NullOr(Schema.String),
});

/** Asks a service for its identity with the local token. Anything but an answer is `undefined`. */
export const probe = (endpoint: Endpoint, timeout: Duration.Input = Duration.seconds(2)) =>
  HttpClient.execute(
    HttpClientRequest.get(`${endpoint.url}/api/info`).pipe(
      HttpClientRequest.bearerToken(endpoint.token),
    ),
  ).pipe(
    Effect.flatMap((response) =>
      response.status !== 200 && response.status !== 503
        ? Effect.succeed(undefined)
        : response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(InfoResponse)),
            Effect.map(
              (body): Health => ({
                state: response.status === 200 ? "ready" : "starting",
                ...body,
              }),
            ),
          ),
    ),
    Effect.timeout(timeout),
    Effect.catch(() => Effect.succeed(undefined)),
  );

export interface Status {
  readonly info: ServiceRegistration.Info;
  /** Absent when the registered service does not answer as itself. */
  readonly health: Health | undefined;
}

/** The registered service and whether it answers, or `undefined` when none is registered. */
export const status = (paths: ServicePaths) =>
  Effect.gen(function* () {
    const info = yield* ServiceRegistration.read(paths.registration);
    if (info === undefined) return undefined;
    const health = yield* probe(info);
    return {
      info,
      health: health !== undefined && health.pid === info.pid ? health : undefined,
    } satisfies Status;
  });

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM";
  }
};

const signal = (pid: number, name: NodeJS.Signals) =>
  Effect.sync(() => {
    try {
      process.kill(pid, name);
    } catch {}
  });

const waitUntilStopped = (pid: number, timeout: Duration.Input) =>
  Effect.gen(function* () {
    const deadline = Date.now() + Duration.toMillis(Duration.fromInputUnsafe(timeout));
    while (alive(pid)) {
      if (Date.now() >= deadline) return false;
      yield* Effect.sleep(Duration.millis(50));
    }
    return true;
  });

/**
 * Stops the registered service, if any, and returns whether one was registered. Signals are only
 * sent to a process that answers as the registered service, so a stale registration whose PID was
 * reused never gets another process killed; such a registration is just removed, which also makes
 * an unresponsive service shut itself down once it notices.
 */
export const stop = (paths: ServicePaths) =>
  Effect.gen(function* () {
    const current = yield* status(paths);
    if (current === undefined) return false;
    const { info, health } = current;
    if (health !== undefined) {
      const latest = yield* ServiceRegistration.read(paths.registration);
      if (latest === undefined || !ServiceRegistration.same(latest, info)) return true;
      yield* signal(info.pid, "SIGTERM");
      if (!(yield* waitUntilStopped(info.pid, Duration.seconds(15)))) {
        yield* signal(info.pid, "SIGKILL");
        if (!(yield* waitUntilStopped(info.pid, Duration.seconds(5))))
          return yield* new ServiceError({
            message: `Service process ${info.pid} is still running`,
          });
      }
    }
    yield* ServiceRegistration.removeIfOwned(paths.registration, info);
    return true;
  });

const stderrLimit = 8 * 1024;

/** A service process started by `ensure`, detached so it outlives this one. */
const spawnContender = (command: ReadonlyArray<string>, env: NodeJS.ProcessEnv) =>
  Effect.sync(() => {
    const [file, ...args] = command;
    if (file === undefined) throw new Error("Missing service command");
    const child = spawn(file, args, {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      env,
    });
    let stderr = "";
    let failure: Error | undefined;
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-stderrLimit);
    });
    child.once("error", (error) => (failure = error));
    child.unref();
    return {
      stderr: () => stderr.trim(),
      /** Why the process could not start or ended, or `undefined` while it runs. */
      outcome: (): { readonly code: number | null; readonly error?: Error } | undefined =>
        failure !== undefined
          ? { code: null, error: failure }
          : child.exitCode !== null || child.signalCode !== null
            ? { code: child.exitCode }
            : undefined,
      /** Stops listening to its stderr, so this process can exit while the service keeps running. */
      release: () => child.stderr?.destroy(),
    };
  });

/** The Node flags a spawned copy of this process needs to behave the same. */
const nodeFlags = () =>
  process.execArgv.flatMap((arg, index, args) => {
    if (arg === "--conditions") {
      const value = args[index + 1];
      return value === undefined ? [] : [arg, value];
    }
    return arg.startsWith("--conditions=") ||
      arg === "--enable-source-maps" ||
      arg === "--no-warnings" ||
      arg.startsWith("--disable-warning=")
      ? [arg]
      : [];
  });

/**
 * The command that runs a CLI entrypoint with this Node and its relevant flags: by default the
 * running one, so the built CLI spawns its bundle and a source build spawns itself.
 */
export const selfCommand = (
  args: ReadonlyArray<string>,
  entry: string | undefined = process.argv[1],
  flags: ReadonlyArray<string> = [],
): ReadonlyArray<string> => {
  if (entry === undefined) throw new Error("Could not find the CLI entrypoint");
  const node = nodeFlags();
  return [
    process.execPath,
    ...node,
    ...flags.filter((flag) => !node.includes(flag)),
    resolve(entry),
    ...args,
  ];
};

/** Why `ensure` gives up on the local channel when nothing says how to start its server. */
export const noLocalDevServer =
  "No local MacroGraph dev server is running. Start it with `pnpm dev` in apps/server.";

export interface EnsureOptions {
  readonly paths: ServicePaths;
  /**
   * How to start the service. Defaults to this CLI's `serve --service`, except on the local
   * channel, whose server is built from source by `pnpm dev`: without a command, `ensure` never
   * starts one there.
   */
  readonly command?: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeout?: Duration.Input;
}

/**
 * Returns a ready service of this version, reusing the registered one when it answers, replacing it
 * when its version differs, and otherwise starting one in the background. On the local channel the
 * registered server is used whatever its version, and one is only started with an explicit command.
 */
export const ensure = (options: EnsureOptions) => {
  let contender: Effect.Success<ReturnType<typeof spawnContender>> | undefined;
  return Effect.gen(function* () {
    const deadline =
      Date.now() +
      Duration.toMillis(Duration.fromInputUnsafe(options.timeout ?? Duration.seconds(30)));
    const startFailure = (message: string) => {
      const stderr = contender?.stderr() ?? "";
      return new ServiceError({ message: stderr === "" ? message : `${message}\n${stderr}` });
    };
    const devServer = options.paths.channel === Channel.local;
    const command =
      options.command ?? (devServer ? undefined : selfCommand(["serve", "--service"]));
    while (true) {
      const current = yield* status(options.paths);
      if (current?.health !== undefined) {
        if (!devServer && current.health.version !== version) {
          yield* Effect.logInfo(
            `Replacing the background service ${current.health.version} with ${version}`,
          );
          yield* stop(options.paths);
          continue;
        }
        if (current.health.state === "ready")
          return { info: current.info, setupUrl: current.health.setupUrl };
      } else if (command === undefined) {
        return yield* new ServiceError({ message: noLocalDevServer });
      } else {
        const outcome = contender?.outcome();
        if (outcome?.error !== undefined)
          return yield* startFailure(`Could not start the service: ${outcome.error.message}`);
        if (outcome !== undefined && outcome.code !== 0)
          return yield* startFailure(
            `The service exited with ${outcome.code === null ? "a signal" : `code ${outcome.code}`}`,
          );
        // A contender that exits cleanly found another service on the port; look again.
        if (contender === undefined || outcome !== undefined)
          contender = yield* spawnContender(command, {
            ...(options.env ?? process.env),
            MACROGRAPH_CHANNEL: options.paths.channel,
          });
      }
      if (Date.now() >= deadline)
        return yield* startFailure("Timed out waiting for the service to start");
      yield* Effect.sleep(Duration.millis(100));
    }
  }).pipe(Effect.ensuring(Effect.sync(() => contender?.release())));
};

/**
 * An explicitly chosen server, bypassing discovery and auto-start. The token comes from
 * `MACROGRAPH_TOKEN`; it fails unless the server answers as a MacroGraph server with it.
 */
export const explicit = (server: string, token: string | undefined) =>
  Effect.gen(function* () {
    if (token === undefined || token === "")
      return yield* new ServiceError({
        message:
          "Set MACROGRAPH_TOKEN to the server's local token (`macrograph service get token`) to use --server",
      });
    const endpoint: Endpoint = { url: server.replace(/\/+$/, ""), token };
    const health = yield* probe(endpoint);
    if (health === undefined)
      return yield* new ServiceError({
        message: `No MacroGraph server answered at ${endpoint.url} with MACROGRAPH_TOKEN`,
      });
    return { endpoint, health };
  });

export * as ServiceClient from "./ServiceClient.ts";
