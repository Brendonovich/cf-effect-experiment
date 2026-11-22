import type { Manifest } from "@macrograph/module/Manifest";

import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect, Layer, Option } from "effect";
import { HttpServerResponse } from "effect/http";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ModuleEvaluator } from "../src/ModuleEvaluator.ts";
import { ModuleRegistry } from "../src/ModuleRegistry.ts";
import { ModuleTrust } from "../src/ModuleTrust.ts";
import { Mounter } from "../src/Mounter.ts";

export const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

export const tempDir = () => mkdtempSync(join(tmpdir(), "macrograph-module-host-"));

export const official = (name: string, publisher = "fixtures") =>
  ModuleId.make({ namespace: ModuleId.OfficialNamespace, publisher, name });

export const local = (name: string, publisher = "fixtures") =>
  ModuleId.make({ namespace: ModuleId.LocalNamespace, publisher, name });

type ManifestPatch = { -readonly [K in keyof Manifest.Model]?: Manifest.Model[K] };

const patchManifest = (dir: string, patch: ManifestPatch) => {
  const path = join(dir, "macrograph.json");
  const manifest: Record<string, unknown> = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...manifest, ...patch }, null, 2));
};

/** Copies a fixture package to `dir`, optionally patching its manifest. */
export const copyFixture = (name: string, dir: string, patch: ManifestPatch = {}) => {
  mkdirSync(dir, { recursive: true });
  cpSync(fixture(name), dir, { recursive: true });
  patchManifest(dir, patch);
  return dir;
};

/** Writes a minimal module package whose default export reports its version and source. */
export const writeModule = (
  dir: string,
  fields: { publisher?: string; name: string; version: string; api?: number; tag?: string },
) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "macrograph.json"),
    JSON.stringify({
      manifest: 1,
      publisher: fields.publisher ?? "fixtures",
      name: fields.name,
      version: fields.version,
      api: fields.api ?? 1,
      displayName: fields.name,
      server: "server.cjs",
    }),
  );
  writeFileSync(
    join(dir, "server.cjs"),
    `exports.default = { version: ${JSON.stringify(fields.version)}, tag: ${JSON.stringify(fields.tag ?? "")} };\n`,
  );
  return dir;
};

/** `<root>/<namespace>/<publisher>/<name>/<version>/` */
export const versionedDir = (root: string, id: ModuleId.Id, version: string) => {
  const parts = ModuleId.parts(id);
  return join(root, parts.namespace, parts.publisher, parts.name, version);
};

export interface MountRecord {
  readonly id: ModuleId.Id;
  readonly deployment: unknown;
}

/** A mounter that records what's mounted and unmounts in the module's scope. */
export const makeTestMounter = (options: { onMount?: (input: Mounter.Input) => void } = {}) => {
  const mounted = new Map<ModuleId.Id, MountRecord>();
  const events: Array<string> = [];
  const layer = Layer.succeed(Mounter.Service, {
    mount: (input) =>
      Effect.gen(function* () {
        const deployment = input.deployment;
        if (
          typeof deployment === "object" &&
          deployment !== null &&
          "failMount" in deployment &&
          deployment.failMount === true
        )
          return yield* new Mounter.MountError({ id: input.id, message: "refused by test" });
        if (mounted.has(input.id)) return yield* Effect.die(`${input.id} mounted twice`);
        options.onMount?.(input);
        mounted.set(input.id, { id: input.id, deployment });
        events.push(`mount ${input.id}`);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            mounted.delete(input.id);
            events.push(`unmount ${input.id}`);
          }),
        );
        return {
          rpc: Option.some(Effect.succeed(HttpServerResponse.text(`rpc ${input.id}`))),
        };
      }),
  });
  return { mounted, events, layer };
};

export const registryLayer = (
  options: Partial<ModuleRegistry.Options>,
  mounter: Layer.Layer<Mounter.Service> = makeTestMounter().layer,
  trust: Layer.Layer<ModuleTrust.Service> = ModuleTrust.none,
) =>
  ModuleRegistry.layer({
    hostServices: ["http-client", "file-system", "socket", "crypto", "credentials"],
    watch: false,
    ...options,
  }).pipe(Layer.provide([mounter, ModuleEvaluator.vm, trust]));
