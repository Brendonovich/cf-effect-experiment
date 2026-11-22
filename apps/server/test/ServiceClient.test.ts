import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { once } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ServiceClient } from "../src/ServiceClient.ts";
import { ServicePaths } from "../src/ServicePaths.ts";
import { ServiceRegistration } from "../src/ServiceRegistration.ts";

const pathsFor = (channel: string) => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-client-"));
  return {
    root,
    paths: ServicePaths.make(channel, {
      XDG_STATE_HOME: join(root, "state"),
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
    }),
  };
};

/** A stand-in for a server's `/api/info`, answering as `pid` with `version`. */
const fakeServer = (token: string, version = "9.9.9") =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const server = createServer((request, response) => {
        if (request.headers.authorization !== `Bearer ${token}`)
          return response.writeHead(401).end();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version, pid: process.pid, setupUrl: null }));
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("No address");
      return { server, url: `http://127.0.0.1:${address.port}` };
    }),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

describe("service client", () => {
  it("spawns itself: this Node, its relevant flags, and the entrypoint", () => {
    assert.deepStrictEqual(
      ServiceClient.selfCommand(["serve", "--service"], "/x/index.mjs", [
        "--enable-source-maps",
      ]).slice(-4),
      ["--enable-source-maps", "/x/index.mjs", "serve", "--service"],
    );
    assert.strictEqual(ServiceClient.selfCommand([], "/x/index.mjs")[0], process.execPath);
  });

  it.live("never starts a service on the local channel without an explicit command", () =>
    Effect.gen(function* () {
      const { root, paths } = pathsFor("local");
      const marker = join(root, "spawned");
      // A stale registration names how it was started, but only `pnpm dev` passes a command.
      yield* ServiceRegistration.write(paths.registration, {
        id: "stale",
        version: "0.0.1",
        url: "http://127.0.0.1:9",
        pid: 2 ** 22 + 1,
        token: "t",
        command: [
          process.execPath,
          "-e",
          `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`,
        ],
      });
      const started = Date.now();
      const error = yield* ServiceClient.ensure({ paths }).pipe(Effect.flip);
      assert.strictEqual(error.message, ServiceClient.noLocalDevServer);
      assert.isBelow(Date.now() - started, 2_000);
      assert.isFalse(existsSync(marker));
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

  it.live("starts the local channel's service with an explicit command", () =>
    Effect.gen(function* () {
      const { root, paths } = pathsFor("local");
      const marker = join(root, "spawned");
      const error = yield* ServiceClient.ensure({
        paths,
        command: [
          process.execPath,
          "-e",
          `require("fs").writeFileSync(${JSON.stringify(marker)}, ""); process.exit(3)`,
        ],
      }).pipe(Effect.flip);
      assert.include(error.message, "The service exited with code 3");
      assert.isTrue(existsSync(marker));
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

  it.live("uses the registered dev server on the local channel whatever its version", () =>
    Effect.gen(function* () {
      const { paths } = pathsFor("local");
      const dev = yield* fakeServer("dev-token", "0.0.0-dev");
      const info = {
        id: "dev",
        version: "0.0.0-dev",
        url: dev.url,
        pid: process.pid,
        token: "dev-token",
      };
      const scope = yield* Scope.make();
      yield* ServiceRegistration.register({
        path: paths.registration,
        info,
        shutdown: Effect.void,
      }).pipe(Scope.provide(scope));
      const found = yield* ServiceClient.ensure({ paths, command: ["false"] });
      assert.deepStrictEqual(found.info, info);
      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.live("connects to an explicit --server with MACROGRAPH_TOKEN", () =>
    Effect.gen(function* () {
      const server = yield* fakeServer("secret");
      const missing = yield* ServiceClient.explicit(server.url, undefined).pipe(Effect.flip);
      assert.include(missing.message, "MACROGRAPH_TOKEN");
      const wrong = yield* ServiceClient.explicit(server.url, "nope").pipe(Effect.flip);
      assert.include(wrong.message, `No MacroGraph server answered at ${server.url}`);

      const { endpoint, health } = yield* ServiceClient.explicit(`${server.url}/`, "secret");
      assert.deepStrictEqual(endpoint, { url: server.url, token: "secret" });
      assert.strictEqual(health.pid, process.pid);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});
