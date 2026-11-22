import { NodeHttpServer } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpClient, HttpRouter } from "effect/http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClientBuildManifest } from "../src/ClientBuildManifest.ts";
import { StaticRoutes } from "../src/StaticRoutes.ts";

const importMapHash = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

const makeRoot = (manifest: object | undefined) => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-static-"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>MacroGraph</title>");
  mkdirSync(join(root, "_shared", "abc"), { recursive: true });
  writeFileSync(join(root, "_shared", "abc", "effect.js"), "export {};");
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "index.js"), "export {};");
  if (manifest !== undefined) {
    mkdirSync(join(root, ".macrograph"));
    writeFileSync(join(root, ClientBuildManifest.file), JSON.stringify(manifest));
  }
  return root;
};

const serve = (root: string) =>
  HttpRouter.serve(
    StaticRoutes.layer({ root, basePath: "/macrograph", publicOrigin: "http://localhost:3000" }),
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));

const scriptSrc = (csp: string | undefined) =>
  csp
    ?.split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("script-src "));

describe("StaticRoutes", () => {
  it.layer(
    serve(
      makeRoot({
        version: 1,
        importMap: { imports: { effect: "/macrograph/_shared/abc/effect.js" } },
        scriptSrc: [importMapHash],
        files: ["_shared/abc/effect.js"],
      }),
    ),
  )("with a shared libraries build manifest", (it) => {
    it.effect("allows the inline import map in script-src", () =>
      Effect.gen(function* () {
        const response = yield* HttpClient.get("/macrograph/");
        assert.strictEqual(response.status, 200);
        assert.strictEqual(
          scriptSrc(response.headers["content-security-policy"]),
          `script-src 'self' ${importMapHash}`,
        );
      }),
    );

    it.effect("serves shared libraries with immutable caching", () =>
      Effect.gen(function* () {
        const shared = yield* HttpClient.get("/macrograph/_shared/abc/effect.js");
        assert.strictEqual(shared.status, 200);
        assert.strictEqual(shared.headers["cache-control"], "public, max-age=31536000, immutable");
        assert.strictEqual(
          scriptSrc(shared.headers["content-security-policy"]),
          `script-src 'self' ${importMapHash}`,
        );
        const index = yield* HttpClient.get("/macrograph/");
        assert.strictEqual(index.headers["cache-control"], "no-cache");
      }),
    );

    it.effect("does not serve the build manifest", () =>
      Effect.gen(function* () {
        const response = yield* HttpClient.get(`/macrograph/${ClientBuildManifest.file}`);
        assert.strictEqual(response.status, 400);
      }),
    );
  });

  it.layer(serve(makeRoot(undefined)))("without a build manifest", (it) => {
    it.effect("keeps script-src to self", () =>
      Effect.gen(function* () {
        const response = yield* HttpClient.get("/macrograph/");
        assert.strictEqual(
          scriptSrc(response.headers["content-security-policy"]),
          "script-src 'self'",
        );
      }),
    );
  });

  it.effect("rejects manifests with sources other than script hashes", () =>
    Effect.gen(function* () {
      const root = makeRoot({ scriptSrc: ["'unsafe-inline'"] });
      const exit = yield* Effect.exit(ClientBuildManifest.scriptSources(root));
      assert.strictEqual(exit._tag, "Failure");
    }),
  );
});
