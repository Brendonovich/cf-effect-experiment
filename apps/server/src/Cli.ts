import type { HttpClient } from "effect/http";

import { Deferred, Duration, Effect, Layer, Logger, Option, Stdio, Stream } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { randomUUID } from "node:crypto";

import { Channel } from "./Channel.ts";
import { LocalAccess } from "./LocalAccess.ts";
import { McpRelay } from "./McpRelay.ts";
import { ServerConfig } from "./ServerConfig.ts";
import { ServiceClient } from "./ServiceClient.ts";
import { ServiceConfig } from "./ServiceConfig.ts";
import { ServicePaths } from "./ServicePaths.ts";
import { ServiceRegistration } from "./ServiceRegistration.ts";
import { version } from "./Version.ts";

const print = (line: string) => Effect.sync(() => console.log(line));

/** A host as it appears in a URL; wildcard binds are reached through loopback. */
const urlHost = (hostname: string) =>
  hostname === "0.0.0.0"
    ? "127.0.0.1"
    : hostname === "::"
      ? "[::1]"
      : hostname.includes(":")
        ? `[${hostname}]`
        : hostname;

const addressInUse = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("code" in error && error.code === "EADDRINUSE") ||
    ("cause" in error && addressInUse(error.cause)));

const serverConfig = (env: NodeJS.ProcessEnv) =>
  Effect.try({
    try: () => ServerConfig.makeServerConfig(env),
    catch: (error) =>
      new ServiceClient.ServiceError({
        message: error instanceof Error ? error.message : String(error),
      }),
  });

// Loaded on demand so service management and the MCP relay start without loading every module.
const loadServer = Effect.promise(() => import("./Server.ts"));

/** The current channel's service files: `MACROGRAPH_CHANNEL`, else the build's channel. */
const channelPaths = () => ServicePaths.make(Channel.current());

const ensure = Effect.suspend(() => ServiceClient.ensure({ paths: channelPaths() }));

/**
 * Starts the channel's service. The local channel's server runs from source, so it is only started
 * with the command it was registered with, which `pnpm dev` records when it starts one.
 */
const start = (paths: ServicePaths, command: ReadonlyArray<string> | undefined) =>
  ServiceClient.ensure({ paths, ...(command === undefined ? {} : { command }) });

const registeredCommand = (paths: ServicePaths) =>
  paths.channel === Channel.local
    ? ServiceRegistration.read(paths.registration).pipe(Effect.map((info) => info?.command))
    : Effect.succeed(undefined);

/** Stops the channel's service and starts it again the same way. */
const restartService = (paths: ServicePaths) =>
  Effect.gen(function* () {
    const command = yield* registeredCommand(paths);
    yield* ServiceClient.stop(paths);
    return yield* start(paths, command);
  });

const serverFlag = Flag.String("server").pipe(
  Flag.optional,
  Flag.withDescription(
    "Use the MacroGraph server at this URL, authenticated with MACROGRAPH_TOKEN, instead of the channel's service",
  ),
);

const printService = (url: string, setupUrl: string | null) =>
  print(url).pipe(
    Effect.andThen(setupUrl === null ? Effect.void : print(`Set up this server at ${setupUrl}`)),
  );

/** Runs the server in the foreground, configured by the environment and flags. */
const serveForeground = (flags: { readonly port?: number; readonly hostname?: string }) =>
  Effect.gen(function* () {
    const overrides = {
      ...(flags.port === undefined ? {} : { PORT: String(flags.port) }),
      ...(flags.hostname === undefined ? {} : { HOST: flags.hostname }),
    };
    // Validate before importing Server, which reads the environment when it loads.
    yield* serverConfig({ ...process.env, ...overrides });
    Object.assign(process.env, overrides);
    const Server = yield* loadServer;
    return yield* Layer.launch(Server.service({ announce: (line) => console.log(line) })).pipe(
      Effect.orDie,
      Effect.provideService(Logger.LogToStderr, false),
    );
  });

/**
 * Runs the background service: a loopback server on a fixed port that publishes its URL and local
 * token in the registration file. Exits quietly if a healthy service already holds the port.
 */
const serveService = (flags: { readonly port?: number; readonly hostname?: string }) =>
  Effect.gen(function* () {
    // Whoever started us stops reading stderr once we're ready; later writes must not crash us.
    for (const stream of [process.stdout, process.stderr]) stream.on("error", () => {});
    const paths = channelPaths();
    const { config: stored, token } = yield* ServiceConfig.loadWithToken(paths.config);
    const hostname = flags.hostname ?? stored.hostname ?? ServiceConfig.defaultHostname;
    const port = flags.port ?? stored.port ?? Channel.defaultPort(paths.channel);
    const origin = `http://${urlHost(hostname)}:${port}`;
    const config = yield* serverConfig({
      ...process.env,
      HOST: hostname,
      PORT: String(port),
      MACROGRAPH_DATA_DIR: process.env.MACROGRAPH_DATA_DIR ?? paths.data,
      MACROGRAPH_PUBLIC_ORIGIN: process.env.MACROGRAPH_PUBLIC_ORIGIN ?? origin,
    });
    // Server reads the environment when it loads, which is after this point.
    Object.assign(process.env, {
      HOST: hostname,
      PORT: String(port),
      MACROGRAPH_DATA_DIR: process.env.MACROGRAPH_DATA_DIR ?? paths.data,
      MACROGRAPH_PUBLIC_ORIGIN: process.env.MACROGRAPH_PUBLIC_ORIGIN ?? origin,
    });
    const url = `${origin}${config.basePath}`;
    const incumbent = ServiceClient.probe({ url, token }).pipe(
      Effect.map((health) => health !== undefined),
    );
    if (yield* incumbent)
      return yield* Effect.logInfo(`A MacroGraph service is already running at ${url}`);

    const Server = yield* loadServer;
    const shutdown = yield* Deferred.make<void>();
    const id = randomUUID();
    const launch = Effect.scoped(
      Layer.build(
        Server.service({
          local: LocalAccess.make(token),
          announce: (line) => console.error(line),
          onListen: (bound) =>
            ServiceRegistration.register({
              path: paths.registration,
              info: {
                id,
                version,
                url: `http://${urlHost(hostname)}:${bound}${config.basePath}`,
                pid: process.pid,
                token,
                command: ServiceClient.selfCommand(process.argv.slice(2)),
              },
              shutdown: Deferred.succeed(shutdown, undefined).pipe(Effect.asVoid),
            }),
        }),
      ).pipe(Effect.andThen(Deferred.await(shutdown))),
    );
    const deadline = Date.now() + 15_000;
    // Another service may be starting on the port: wait for it to answer rather than fail.
    const attempt = (): Effect.Effect<void, ServiceClient.ServiceError, HttpClient.HttpClient> =>
      launch.pipe(
        Effect.catch((error) =>
          !addressInUse(error)
            ? Effect.die(error)
            : Effect.gen(function* () {
                if (yield* incumbent) return;
                if (Date.now() >= deadline)
                  return yield* new ServiceClient.ServiceError({
                    message:
                      `Port ${port} on ${hostname} is in use by another process. ` +
                      "Choose another with `macrograph service set port <port>`.",
                  });
                yield* Effect.sleep(Duration.millis(250));
                return yield* attempt();
              }),
        ),
      );
    yield* attempt();
  });

const serve = Command.make(
  "serve",
  {
    port: Flag.Int("port").pipe(Flag.optional, Flag.withDescription("Port to listen on")),
    hostname: Flag.String("hostname").pipe(
      Flag.optional,
      Flag.withDescription("Hostname or address to listen on"),
    ),
    service: Flag.Boolean("service").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Run as the per-user background service"),
    ),
  },
  (input) => {
    const flags = {
      ...Option.match(input.port, { onNone: () => ({}), onSome: (port) => ({ port }) }),
      ...Option.match(input.hostname, { onNone: () => ({}), onSome: (hostname) => ({ hostname }) }),
    };
    return input.service ? serveService(flags) : serveForeground(flags);
  },
).pipe(
  Command.withDescription(
    "Run the server in the foreground, configured by PORT, HOST and the other MACROGRAPH_* variables",
  ),
);

const startCommand = Command.make("start", {}, () =>
  Effect.suspend(() => {
    const paths = channelPaths();
    return registeredCommand(paths).pipe(Effect.flatMap((command) => start(paths, command)));
  }).pipe(Effect.flatMap(({ info, setupUrl }) => printService(info.url, setupUrl))),
).pipe(Command.withDescription("Start the background service if it isn't running"));

const stop = Command.make("stop", {}, () =>
  Effect.suspend(() => {
    const paths = channelPaths();
    return ServiceClient.stop(paths);
  }).pipe(
    Effect.flatMap((stopped) =>
      print(stopped ? "Stopped the MacroGraph service" : "The MacroGraph service is not running"),
    ),
  ),
).pipe(Command.withDescription("Stop the background service"));

const restart = Command.make("restart", {}, () =>
  Effect.suspend(() => restartService(channelPaths())).pipe(
    Effect.flatMap(({ info, setupUrl }) => printService(info.url, setupUrl)),
  ),
).pipe(Command.withDescription("Restart the background service"));

const printHealth = (
  url: string,
  health: ServiceClient.Health,
  extra: ReadonlyArray<string> = [],
) =>
  print(
    [
      `status:       ${health.state === "ready" ? "running" : "starting"}`,
      `url:          ${url}`,
      `version:      ${health.version}`,
      `pid:          ${health.pid}`,
      ...extra,
      ...(health.setupUrl === null ? [] : [`setup:        ${health.setupUrl}`]),
    ].join("\n"),
  );

const status = Command.make("status", { server: serverFlag }, ({ server }) =>
  Effect.gen(function* () {
    if (Option.isSome(server)) {
      const { endpoint, health } = yield* ServiceClient.explicit(
        server.value,
        process.env.MACROGRAPH_TOKEN,
      );
      return yield* printHealth(endpoint.url, health);
    }
    const paths = channelPaths();
    const current = yield* ServiceClient.status(paths);
    if (current?.health === undefined) {
      yield* print(
        current === undefined
          ? paths.channel === Channel.local
            ? ServiceClient.noLocalDevServer
            : "The MacroGraph service is not running"
          : `The MacroGraph service registered at ${current.info.url} is not answering`,
      );
      return yield* Effect.sync(() => void (process.exitCode = 1));
    }
    yield* printHealth(current.info.url, current.health, [
      `channel:      ${paths.channel}`,
      `registration: ${paths.registration}`,
    ]);
  }),
).pipe(Command.withDescription("Show whether the background service is running, and where"));

const keyArgument = Argument.Literals("key", ServiceConfig.keys).pipe(
  Argument.withDescription("hostname, port or token"),
);

/**
 * Settings take effect on the next start. The service is stopped so the next use restarts it; the
 * local channel's is restarted straight away, since nothing else would start it.
 */
const saveConfig = (paths: ServicePaths, config: ServiceConfig.Config) =>
  Effect.gen(function* () {
    yield* ServiceConfig.write(paths.config, config);
    if (paths.channel === Channel.local) {
      const current = yield* ServiceClient.status(paths);
      if (current?.health === undefined || current.info.command === undefined) return;
      const { info } = yield* restartService(paths);
      return yield* print(`Restarted the local MacroGraph server at ${info.url}`);
    }
    if (yield* ServiceClient.stop(paths))
      yield* print("Stopped the MacroGraph service; it restarts with this on next use");
  });

const get = Command.make("get", { key: keyArgument }, ({ key }) =>
  Effect.gen(function* () {
    const paths = channelPaths();
    const config = yield* ServiceConfig.read(paths.config);
    const value =
      config[key] ??
      (key === "port"
        ? Channel.defaultPort(paths.channel)
        : key === "hostname"
          ? ServiceConfig.defaultHostname
          : undefined);
    if (value === undefined)
      return yield* new ServiceConfig.ServiceConfigError({
        message: "No token yet; the service creates one when it first starts",
      });
    yield* print(String(value));
  }),
).pipe(Command.withDescription("Print a service setting"));

const set = Command.make(
  "set",
  { key: keyArgument, value: Argument.String("value") },
  ({ key, value }) =>
    Effect.gen(function* () {
      const paths = channelPaths();
      const parsed = yield* ServiceConfig.parse(key, value);
      yield* saveConfig(paths, { ...(yield* ServiceConfig.read(paths.config)), ...parsed });
    }),
).pipe(Command.withDescription("Change a service setting"));

const unset = Command.make("unset", { key: keyArgument }, ({ key }) =>
  Effect.gen(function* () {
    const paths = channelPaths();
    const { [key]: _, ...rest } = yield* ServiceConfig.read(paths.config);
    yield* saveConfig(paths, rest);
  }),
).pipe(Command.withDescription("Restore a service setting's default; unsetting token rotates it"));

const service = Command.make("service").pipe(
  Command.withDescription("Manage the background service"),
  Command.withSubcommands([startCommand, stop, status, restart, get, set, unset]),
);

/** One client's setup: a command its own CLI runs, or JSON that a file-based client merges. */
export interface ClientSetup {
  /** The stable name `--client` takes. */
  readonly id: string;
  /** The client's display name. */
  readonly name: string;
  /** The command that registers the relay, for clients with their own `mcp add`. */
  readonly command?: string;
  /** Configuration for clients that read a JSON file instead. */
  readonly json?: unknown;
  /** Anything the command needs beyond running it, such as scope. */
  readonly note?: string;
}

/**
 * How to connect each supported client, generated from the channel so the command, the JSON and
 * the docs cannot drift. A channel other than `latest` names its server and passes the channel to
 * the relay's environment.
 */
export const clientSetups = (channel: string): ReadonlyArray<ClientSetup> => {
  const latest = channel === Channel.latest;
  const name = latest ? "macrograph" : `macrograph${Channel.suffix(channel)}`;
  const scope = latest ? "" : ` --env MACROGRAPH_CHANNEL=${channel}`;
  return [
    {
      id: "opencode",
      name: "OpenCode",
      command: `opencode mcp add ${name}${scope} -- macrograph mcp`,
      note: "Add --global to connect it in every project.",
    },
    {
      id: "claude-code",
      name: "Claude Code",
      command: `claude mcp add ${name}${latest ? "" : ` -e MACROGRAPH_CHANNEL=${channel}`} -- macrograph mcp`,
    },
    {
      id: "codex",
      name: "Codex",
      command: `codex mcp add ${name}${scope} -- macrograph mcp`,
    },
    {
      id: "cursor",
      name: "Cursor and other clients",
      json: {
        mcpServers: {
          [name]: {
            command: "macrograph",
            args: ["mcp"],
            ...(latest ? {} : { env: { MACROGRAPH_CHANNEL: channel } }),
          },
        },
      },
      note: "Merge this into the client's MCP configuration file.",
    },
  ];
};

const formatSetup = (setup: ClientSetup) =>
  [
    setup.name,
    ...(setup.command === undefined ? [] : [`  ${setup.command}`]),
    ...(setup.json === undefined
      ? []
      : JSON.stringify(setup.json, null, 2)
          .split("\n")
          .map((line) => `  ${line}`)),
    ...(setup.note === undefined ? [] : [`  ${setup.note}`]),
  ].join("\n");

const mcpConfig = Command.make(
  "config",
  {
    channel: Flag.String("channel").pipe(
      Flag.optional,
      Flag.withDescription(
        "The channel to connect to; defaults to MACROGRAPH_CHANNEL or this build's",
      ),
    ),
    client: Flag.String("client").pipe(
      Flag.optional,
      Flag.withDescription("Print only this client's setup, such as opencode or claude-code"),
    ),
  },
  ({ channel, client }) =>
    Effect.suspend(() => {
      const setups = clientSetups(Option.getOrElse(channel, () => Channel.current()));
      if (Option.isSome(client)) {
        const setup = setups.find((entry) => entry.id === client.value);
        if (setup === undefined)
          return Effect.sync(() => {
            process.stderr.write(
              `macrograph: unknown client "${client.value}". Choose one of: ${setups.map((entry) => entry.id).join(", ")}\n`,
            );
            process.exitCode = 1;
          });
        return print(formatSetup(setup));
      }
      return print(
        ["Add MacroGraph to an MCP client:", "", setups.map(formatSetup).join("\n\n")].join("\n"),
      );
    }),
).pipe(Command.withDescription("Print how to connect an MCP client"));

/** The local service is the only one `macrograph service status` can inspect. */
const localMcpInstructions =
  "This connection runs through the `macrograph` CLI over stdio. If a tool call reports that the MacroGraph service cannot be reached, `macrograph service status` shows whether it is running.";

const mcp = Command.make("mcp", { server: serverFlag }, ({ server }) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    yield* McpRelay.run({
      input: stdio.stdin.pipe(Stream.decodeText(), Stream.splitLines),
      write: (line) =>
        Effect.callback<void>((resume) => {
          process.stdout.write(`${line}\n`, () => resume(Effect.void));
        }),
      ...(Option.isNone(server) ? { instructions: localMcpInstructions } : {}),
      connect: Option.isSome(server)
        ? ServiceClient.explicit(server.value, process.env.MACROGRAPH_TOKEN).pipe(
            Effect.map(({ endpoint }) => endpoint),
          )
        : ensure.pipe(Effect.map(({ info }) => ({ url: info.url, token: info.token }))),
    });
  }),
).pipe(
  Command.withDescription("Serve MCP over stdio, relayed to the channel's service or --server"),
  Command.withSubcommands([mcpConfig]),
);

export const command = Command.make("macrograph", {}, () =>
  ensure.pipe(Effect.flatMap(({ info, setupUrl }) => printService(info.url, setupUrl))),
).pipe(
  Command.withDescription("Start the MacroGraph background service if needed and print its URL"),
  Command.withSubcommands([serve, service, mcp]),
);

export const run = Command.run(command, { version });

export * as Cli from "./Cli.ts";
