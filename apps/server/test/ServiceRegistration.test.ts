import { assert, describe, it } from "@effect/vitest";
import { Deferred, Duration, Effect, Exit, Scope } from "effect";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ServiceRegistration } from "../src/ServiceRegistration.ts";

const info = (id: string): ServiceRegistration.Info => ({
  id,
  version: "0.0.1",
  url: "http://127.0.0.1:3170",
  pid: process.pid,
  token: "token",
});

const registrationPath = () =>
  join(mkdtempSync(join(tmpdir(), "macrograph-registration-")), "state", "service.json");

describe("service registration", () => {
  it.effect("publishes an owner-only file and removes it when the service stops", () =>
    Effect.gen(function* () {
      const path = registrationPath();
      const scope = yield* Scope.make();
      yield* ServiceRegistration.register({
        path,
        info: info("a"),
        shutdown: Effect.void,
      }).pipe(Scope.provide(scope));

      assert.strictEqual(statSync(path).mode & 0o777, 0o600);
      assert.deepStrictEqual(JSON.parse(readFileSync(path, "utf8")), info("a"));
      assert.deepStrictEqual(yield* ServiceRegistration.read(path), info("a"));

      yield* Scope.close(scope, Exit.void);
      assert.isUndefined(yield* ServiceRegistration.read(path));
    }),
  );

  it.effect("leaves a successor's registration alone and shuts down when replaced", () =>
    Effect.gen(function* () {
      const path = registrationPath();
      const scope = yield* Scope.make();
      const shutdown = yield* Deferred.make<void>();
      yield* ServiceRegistration.register({
        path,
        info: info("a"),
        shutdown: Deferred.succeed(shutdown, undefined).pipe(Effect.asVoid),
        checkInterval: Duration.millis(10),
      }).pipe(Scope.provide(scope));

      writeFileSync(path, JSON.stringify(info("b")));
      yield* Deferred.await(shutdown).pipe(Effect.timeout(Duration.seconds(5)));

      yield* Scope.close(scope, Exit.void);
      assert.deepStrictEqual(yield* ServiceRegistration.read(path), info("b"));
      yield* ServiceRegistration.removeIfOwned(path, info("a"));
      assert.deepStrictEqual(yield* ServiceRegistration.read(path), info("b"));
      yield* ServiceRegistration.removeIfOwned(path, info("b"));
      assert.isUndefined(yield* ServiceRegistration.read(path));
    }),
  );

  it.effect("shuts down when the registration is deleted", () =>
    Effect.gen(function* () {
      const path = registrationPath();
      const shutdown = yield* Deferred.make<void>();
      yield* ServiceRegistration.register({
        path,
        info: info("a"),
        shutdown: Deferred.succeed(shutdown, undefined).pipe(Effect.asVoid),
        checkInterval: Duration.millis(10),
      });
      yield* ServiceRegistration.removeIfOwned(path, info("a"));
      yield* Deferred.await(shutdown).pipe(Effect.timeout(Duration.seconds(5)));
    }).pipe(Effect.scoped),
  );

  it.effect("treats invalid files as unregistered", () =>
    Effect.gen(function* () {
      const path = registrationPath();
      yield* ServiceRegistration.register({ path, info: info("a"), shutdown: Effect.void });
      writeFileSync(path, "{");
      assert.isUndefined(yield* ServiceRegistration.read(path));
    }).pipe(Effect.scoped),
  );
});
