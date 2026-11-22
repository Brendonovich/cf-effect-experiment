import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ServiceConfig } from "../src/ServiceConfig.ts";
import { version } from "../src/Version.ts";

describe("service config", () => {
  it.effect("persists owner-only settings and validates values", () =>
    Effect.gen(function* () {
      const path = join(mkdtempSync(join(tmpdir(), "macrograph-config-")), "service.json");
      assert.deepStrictEqual(yield* ServiceConfig.read(path), {});
      const port = yield* ServiceConfig.parse("port", "4100");
      yield* ServiceConfig.write(path, { ...port, token: "secret" });
      assert.strictEqual(statSync(path).mode & 0o777, 0o600);
      assert.deepStrictEqual(yield* ServiceConfig.read(path), { port: 4100, token: "secret" });

      for (const value of ["0", "65536", "1.5", "port"])
        assert.strictEqual(
          (yield* ServiceConfig.parse("port", value).pipe(Effect.flip))._tag,
          "ServiceConfigError",
        );
      assert.strictEqual(
        (yield* ServiceConfig.parse("hostname", "").pipe(Effect.flip))._tag,
        "ServiceConfigError",
      );
    }),
  );

  it("reports the package version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.strictEqual(version, pkg.version);
  });
});
