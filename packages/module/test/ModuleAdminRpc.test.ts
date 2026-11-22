import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";

import { ModuleAdminRpc, ModuleCatalog, ModuleId } from "../src/index.ts";

const id = ModuleId.make({ namespace: "local", publisher: "alice", name: "foo" });

describe("ModuleAdminRpc", () => {
  it("defines every admin RPC", () => {
    assert.deepStrictEqual(
      [...ModuleAdminRpc.ModuleAdminRpcs.requests.keys()],
      [
        "GetModules",
        "ListModules",
        "ReloadModule",
        "RescanModules",
        "SetModuleEnabled",
        "ListRegistries",
        "AddRegistry",
        "RemoveRegistry",
        "SetRegistryTrusted",
        "SearchRegistry",
        "GetRegistryPackage",
        "InstallModule",
        "UpdateModule",
        "UninstallModule",
        "CheckForUpdates",
        "LinkModule",
        "UnlinkModule",
      ],
    );
    assert.isFalse(ModuleAdminRpc.requiresAdmin("GetModules"));
    assert.isTrue(ModuleAdminRpc.requiresAdmin("InstallModule"));
  });

  it("round-trips catalog entries and install payloads", () => {
    const entry: ModuleCatalog.Entry = {
      id,
      version: "1.0.0",
      displayName: "Foo",
      source: "local",
      status: "loaded",
      flags: { ...ModuleCatalog.noFlags, stale: true },
      ui: { entryUrl: `/module/${id}/ui/index.js?v=abc`, styleUrls: [] },
    };
    const json = Schema.encodeSync(ModuleCatalog.Entry)(entry);
    assert.deepStrictEqual(Schema.decodeUnknownSync(ModuleCatalog.Entry)(json), entry);

    const install = Schema.Struct(ModuleAdminRpc.InstallModule.payloadSchema.fields);
    assert.isTrue(
      Exit.isFailure(
        Effect.runSync(
          Effect.exit(
            Schema.decodeUnknownEffect(install)({ id: "bad", acknowledgeUntrusted: false }),
          ),
        ),
      ),
    );
  });

  it("encodes typed errors", () => {
    const error = new ModuleAdminRpc.UntrustedConfirmationRequired({
      id,
      version: "1.0.0",
      registry: "modules.example.com",
      requires: ["http-client"],
      node: [],
      native: ["midi"],
    });
    assert.strictEqual(error._tag, "UntrustedConfirmationRequired");
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(ModuleAdminRpc.ModulesChanged)({
        _tag: "ModulesChanged",
      }),
      { _tag: "ModulesChanged" },
    );
  });
});
