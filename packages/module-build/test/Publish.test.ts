import { Archive } from "@macrograph/module-installer/Archive";
import { Integrity } from "@macrograph/module-registry/Integrity";
import { Publish } from "@macrograph/module-registry/Publish";
import { Manifest } from "@macrograph/module/Manifest";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { Effect } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { Cli } from "../src/Cli.ts";
import { Pack } from "../src/Pack.ts";

const root = mkdtempSync(join(tmpdir(), "macrograph-module-publish-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const manifest: Manifest.Model = {
  manifest: Manifest.FormatVersion,
  publisher: "fixture",
  name: "lights",
  version: "1.2.3",
  api: Manifest.ApiVersion,
  displayName: "Lights",
  server: ModulePackage.ServerEntry,
  ui: { entry: ModulePackage.UiEntry, styles: [] },
};

let folders = 0;
const packageFolder = (server = 'module.exports.default = require("effect");\n') => {
  const directory = join(root, `package-${folders++}`);
  const files: Record<string, string> = {
    [ModulePackage.ManifestFile]: JSON.stringify(manifest),
    [ModulePackage.ServerEntry]: server,
    [ModulePackage.UiEntry]: 'import "solid-js";\nexport default {};\n',
    "assets/icons/light.svg": "<svg/>",
  };
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), contents);
  }
  return directory;
};

const decoder = new TextDecoder();

const readArchive = (bytes: Uint8Array) =>
  Effect.runPromise(Archive.read(bytes)).then((entries) =>
    entries.filter((entry) => entry.data !== undefined),
  );

const silenced = () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  return {
    log,
    error,
    [Symbol.dispose]: () => {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    },
  };
};

const unusedFetch: typeof fetch = () => Promise.reject(new Error("unexpected fetch"));

describe("Pack.tarball", () => {
  it("puts package files at the archive root and is deterministic", async () => {
    const files = [
      { path: "server.cjs", contents: "module.exports.default = {};" },
      { path: "macrograph.json", contents: JSON.stringify(manifest) },
      { path: "ui/index.js", contents: new TextEncoder().encode("export default {};") },
    ];
    const first = await Effect.runPromise(Pack.tarball(files));
    const second = await Effect.runPromise(Pack.tarball([...files].reverse()));
    expect(first).toEqual(second);
    const entries = await readArchive(first);
    expect(entries.map((entry) => entry.path)).toEqual([
      "macrograph.json",
      "server.cjs",
      "ui/index.js",
    ]);
    expect(decoder.decode(entries[1]?.data)).toBe("module.exports.default = {};");
  });

  it("refuses paths outside the package", async () => {
    const exit = await Effect.runPromise(
      Effect.exit(Pack.tarball([{ path: "../escape.js", contents: "" }])),
    );
    expect(exit._tag).toBe("Failure");
  });
});

describe("macrograph-module pack", () => {
  it("writes a tarball of an already built folder", async () => {
    using _ = silenced();
    const tarball = join(root, "out", "lights.tgz");
    const code = await Cli.main(["pack", "--from", packageFolder(), "--tarball", tarball], {
      env: {},
      fetch: unusedFetch,
    });
    expect(code).toBe(0);
    const entries = await readArchive(readFileSync(tarball));
    expect(entries.map((entry) => entry.path).sort()).toEqual([
      "assets/icons/light.svg",
      "macrograph.json",
      "server.cjs",
      "ui/index.js",
    ]);
  });
});

describe("macrograph-module pack (building)", () => {
  it("builds the module first when no folder is given", async () => {
    using _ = silenced();
    const out = join(root, "math-build");
    const tarball = join(root, "math.tgz");
    const math = join(import.meta.dirname, "../../modules/math");
    const code = await Cli.main(["pack", math, "--out", out, "--tarball", tarball], {
      env: {},
      fetch: unusedFetch,
    });
    expect(code).toBe(0);
    const entries = await readArchive(readFileSync(tarball));
    expect(entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(["macrograph.json", "server.cjs"]),
    );
  }, 120_000);
});

describe("macrograph-module publish", () => {
  const fakeRegistry = () => {
    const requests: Array<{ url: string; headers: Headers; body: Uint8Array }> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const body = new Uint8Array(await request.arrayBuffer());
      requests.push({ url: request.url, headers: request.headers, body });
      const integrity = await Effect.runPromise(Integrity.compute(body));
      return Response.json(
        {
          version: manifest.version,
          api: manifest.api,
          publishedAt: "2026-10-27T00:00:00.000Z",
          manifest,
          tarball: `https://registry.test/v1/tarballs/fixture/lights/${manifest.version}.tgz`,
          integrity,
          trust: "untrusted",
          status: "active",
          signature: { keyId: "k", value: "c2ln" },
        },
        { status: 201 },
      );
    };
    return { requests, fetch };
  };

  it("uploads the packed tarball with the token from the environment", async () => {
    using output = silenced();
    const registry = fakeRegistry();
    const code = await Cli.main(
      ["publish", "--from", packageFolder(), "--registry", "https://registry.test"],
      { env: { [Cli.TokenEnvironmentVariable]: "mg_secret" }, fetch: registry.fetch },
    );
    expect(code).toBe(0);
    expect(registry.requests).toHaveLength(1);
    const [request] = registry.requests;
    expect(request?.url).toBe(`https://registry.test${Publish.PublishPath}`);
    expect(request?.headers.get("authorization")).toBe("Bearer mg_secret");
    expect(request?.headers.get("content-type")).toBe(Publish.TarballContentType);
    const entries = await readArchive(request!.body);
    expect(entries.map((entry) => entry.path)).toContain("macrograph.json");
    const printed = output.log.mock.calls.flat().join("\n");
    expect(printed).toContain("version:   1.2.3");
    expect(printed).toContain("integrity: sha256-");
    expect(printed).toContain("trust:     untrusted");
  });

  it("prefers --token and defaults to the official registry", async () => {
    using _ = silenced();
    const registry = fakeRegistry();
    const code = await Cli.main(["publish", "--from", packageFolder(), "--token", "mg_flag"], {
      env: { [Cli.TokenEnvironmentVariable]: "mg_env" },
      fetch: registry.fetch,
    });
    expect(code).toBe(0);
    expect(registry.requests[0]?.url).toBe(`${Cli.DefaultRegistry}${Publish.PublishPath}`);
    expect(registry.requests[0]?.headers.get("authorization")).toBe("Bearer mg_flag");
  });

  it("reports registry rejections", async () => {
    using output = silenced();
    const code = await Cli.main(["publish", "--from", packageFolder(), "--token", "mg"], {
      env: {},
      fetch: async () =>
        Response.json(
          { _tag: "VersionExists", message: "fixture/lights@1.2.3 already exists" },
          { status: 409 },
        ),
    });
    expect(code).toBe(1);
    expect(output.error.mock.calls.flat().join("\n")).toContain("409 VersionExists");
  });

  it("runs the publish checks locally before uploading", async () => {
    using output = silenced();
    const registry = fakeRegistry();
    const tla = await Cli.main(
      [
        "publish",
        "--from",
        packageFolder("await 1;\nmodule.exports.default = {};"),
        "--token",
        "mg",
      ],
      { env: {}, fetch: registry.fetch },
    );
    expect(tla).toBe(1);
    const external = await Cli.main(
      [
        "publish",
        "--from",
        packageFolder('module.exports.default = require("@julusian/midi");'),
        "--token",
        "mg",
      ],
      { env: {}, fetch: registry.fetch },
    );
    expect(external).toBe(1);
    expect(registry.requests).toHaveLength(0);
    const errors = output.error.mock.calls.flat().join("\n");
    expect(errors).toContain("top-level-await");
    expect(errors).toContain("@julusian/midi");
  });

  it("needs a token unless it's a dry run", async () => {
    using _ = silenced();
    const folder = packageFolder();
    expect(await Cli.main(["publish", "--from", folder], { env: {}, fetch: unusedFetch })).toBe(1);
    const tarball = join(root, "dry-run.tgz");
    expect(
      await Cli.main(["publish", "--from", folder, "--dry-run", "--tarball", tarball], {
        env: {},
        fetch: unusedFetch,
      }),
    ).toBe(0);
    expect((await readArchive(readFileSync(tarball))).length).toBe(4);
  });
});
