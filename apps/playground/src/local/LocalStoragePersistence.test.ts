import { Project } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_LOCAL_PROJECT_BYTES,
  decodeLocalProject,
  encodeLocalProject,
  makeLocalProjectStore,
  type StorageLike,
} from "./LocalStoragePersistence";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  failWrites = false;
  failReads = false;
  failRemoves = false;
  failWriteKey: string | undefined;

  getItem(key: string) {
    if (this.failReads) throw new DOMException("Storage unavailable", "SecurityError");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites || key === this.failWriteKey)
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    this.values.set(key, value);
  }

  removeItem(key: string) {
    if (this.failRemoves) throw new DOMException("Storage unavailable", "SecurityError");
    this.values.delete(key);
  }
}

describe("local browser project persistence", () => {
  it("retains named types and intentionally invalid dependent defaults on browser reload", async () => {
    const storage = new MemoryStorage();
    const store = makeLocalProjectStore(storage);
    const project = Schema.decodeUnknownSync(Project.Model)({
      ...Project.empty(),
      types: {
        result: {
          _tag: "Enum",
          id: "result",
          name: "Result",
          variants: [
            {
              name: "Found",
              fields: [
                { name: "record", type: DataType.Custom(DataType.DefinitionId.make("deleted")) },
              ],
            },
          ],
        },
      },
      graphs: {
        graph: {
          id: "graph",
          name: "Preserved",
          connections: [],
          nodes: {
            node: {
              id: "node",
              name: "Invalid but retained",
              schema: { package: "CustomTypes", schema: '["result","stringify"]' },
              position: { x: 0, y: 0 },
              properties: {},
              inputDefaults: {
                value: {
                  _type: "result",
                  _tag: "Found",
                  record: { _type: "deleted", label: "keep" },
                },
                removed: "keep orphan",
              },
            },
          },
        },
      },
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* Persistence.Service).saveProject(project);
      }).pipe(Effect.provide(store.layer), Effect.scoped),
    );
    store.flush();
    const reloaded = makeLocalProjectStore(storage);
    expect(decodeLocalProject(reloaded.exportProject())).toEqual(project);
    await Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* (yield* Persistence.Service).loadProject()).toEqual(project);
      }).pipe(Effect.provide(reloaded.layer), Effect.scoped),
    );
  });

  it("round-trips a versioned project and exports/imports the same schema", async () => {
    const storage = new MemoryStorage();
    const store = makeLocalProjectStore(storage, { debounceMs: 1 });
    const project = { ...Project.empty(), name: "Round trip" };
    await Effect.runPromise(
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        yield* persistence.saveProject(project);
      }).pipe(Effect.provide(store.layer), Effect.scoped),
    );
    store.flush();

    expect(decodeLocalProject(storage.getItem(store.key)!)).toEqual(project);
    const exported = store.exportProject();
    const importedStorage = new MemoryStorage();
    const imported = makeLocalProjectStore(importedStorage);
    expect(imported.importProject(exported)).toEqual(project);
    expect(decodeLocalProject(importedStorage.getItem(imported.key)!)).toEqual(project);
  });

  it("migrates unversioned and version zero projects", () => {
    const project = { ...Project.empty(), name: "Legacy" };
    expect(decodeLocalProject(JSON.stringify(project))).toEqual(project);
    expect(decodeLocalProject(JSON.stringify({ version: 0, project }))).toEqual(project);
    expect(JSON.parse(encodeLocalProject(project))).toMatchObject({ version: 1 });
  });

  it("isolates malformed data and starts with a valid empty project", () => {
    const storage = new MemoryStorage();
    const key = "macrograph:local-project:local-browser";
    storage.setItem(key, "{broken");
    const statuses: Array<string> = [];
    const store = makeLocalProjectStore(storage);
    store.subscribe((status) => statuses.push(status.type));

    expect(statuses).toContain("recovered");
    expect(store.exportProject()).toContain('"version": 1');
    expect(storage.getItem(`${key}:recovery`)).toBe(
      JSON.stringify({ error: "Malformed local project data was not retained." }),
    );
    expect(decodeLocalProject(storage.getItem(store.key)!)).toEqual(Project.empty());
  });

  it("reports quota errors without losing the in-memory export", async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const store = makeLocalProjectStore(storage, { debounceMs: 1 });
    const statuses: Array<string> = [];
    store.subscribe((status) => statuses.push(status.type));
    storage.failWrites = true;
    await Effect.runPromise(
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        yield* persistence.saveProject({ ...Project.empty(), name: "Unsaved" });
      }).pipe(Effect.provide(store.layer), Effect.scoped),
    );
    store.flush();

    expect(statuses).toContain("error");
    expect(() => decodeLocalProject(store.exportProject())).not.toThrow();
    vi.useRealTimers();
  });

  it("recovers a staged write when committing the primary key fails", async () => {
    const storage = new MemoryStorage();
    const store = makeLocalProjectStore(storage);
    storage.failWriteKey = store.key;
    const staged = {
      ...Project.empty(),
      name: "Staged",
      engines: {
        obs: {
          sockets: {
            "ws://localhost:4455": { password: "staged-secret", connectOnStartup: true },
          },
        },
      },
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        yield* persistence.saveProject(staged);
      }).pipe(Effect.provide(store.layer), Effect.scoped),
    );
    expect(storage.getItem(`${store.key}:pending`)).toContain("staged-secret");

    storage.failWriteKey = undefined;
    const recovered = makeLocalProjectStore(storage);
    expect(decodeLocalProject(storage.getItem(recovered.key)!)).toEqual(staged);
    expect(storage.getItem(`${store.key}:pending`)).toBeNull();
  });

  it("continues in memory when storage reads are blocked and reports failed reset removal", () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    const statuses: Array<string> = [];
    const store = makeLocalProjectStore(storage);
    store.subscribe((status) => statuses.push(status.type));
    expect(statuses).toContain("error");
    expect(decodeLocalProject(store.exportProject())).toEqual(Project.empty());

    storage.failReads = false;
    const retained = { ...Project.empty(), name: "Retained" };
    store.importProject(encodeLocalProject(retained));
    storage.failRemoves = true;
    expect(store.reset()).toBe(false);
    expect(statuses.at(-1)).toBe("error");
    expect(decodeLocalProject(store.exportProject())).toEqual(retained);
  });

  it("resets project engine storage, pending, and recovery keys", () => {
    const storage = new MemoryStorage();
    const store = makeLocalProjectStore(storage);
    store.importProject(
      encodeLocalProject({
        ...Project.empty(),
        engines: {
          obs: {
            sockets: {
              "ws://localhost:4455": { password: "secret", connectOnStartup: true },
            },
          },
        },
      }),
    );
    storage.setItem(`${store.key}:pending`, encodeLocalProject(Project.empty()));
    storage.setItem(`${store.key}:recovery`, "broken");
    store.reset();
    expect(storage.values.size).toBe(0);
  });

  it("keeps project engine storage when an atomic reset cannot remove storage", () => {
    const storage = new MemoryStorage();
    const store = makeLocalProjectStore(storage);
    store.importProject(
      encodeLocalProject({
        ...Project.empty(),
        name: "Retained",
        engines: { obs: { sockets: { "ws://localhost:4455": { password: "secret" } } } },
      }),
    );
    storage.failRemoves = true;
    expect(store.reset()).toBe(false);
    expect(storage.getItem(store.key)).toContain("secret");
    expect(decodeLocalProject(store.exportProject()).name).toBe("Retained");
  });

  it("updates the live persistence state on import and reset", async () => {
    const store = makeLocalProjectStore(new MemoryStorage());
    const imported = { ...Project.empty(), name: "Imported live" };
    await Effect.runPromise(
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        store.importProject(encodeLocalProject(imported));
        expect(yield* persistence.loadProject()).toEqual(imported);
        expect(store.reset()).toBe(true);
        expect(yield* persistence.loadProject()).toEqual(Project.empty());
      }).pipe(Effect.provide(store.layer), Effect.scoped),
    );
  });

  it("falls back to valid committed data when staging is corrupt", () => {
    const storage = new MemoryStorage();
    const project = { ...Project.empty(), name: "Committed" };
    const store = makeLocalProjectStore(storage);
    storage.setItem(store.key, encodeLocalProject(project));
    storage.setItem(`${store.key}:pending`, "{broken");

    const recovered = makeLocalProjectStore(storage);
    expect(decodeLocalProject(recovered.exportProject())).toEqual(project);
    expect(storage.getItem(`${store.key}:pending`)).toBeNull();
  });

  it("scopes projects by id and migrates the former unscoped key", () => {
    const storage = new MemoryStorage();
    const legacy = { ...Project.empty(), name: "Legacy local" };
    storage.setItem("macrograph:local-project", JSON.stringify({ version: 1, project: legacy }));

    const local = makeLocalProjectStore(storage);
    const other = makeLocalProjectStore(storage, { projectId: "other" });
    expect(decodeLocalProject(local.exportProject())).toEqual(legacy);
    expect(decodeLocalProject(other.exportProject())).toEqual(Project.empty());
    expect(storage.getItem("macrograph:local-project")).toBeNull();
  });

  it("rejects oversized and prototype-sensitive imports", () => {
    expect(() => decodeLocalProject(" ".repeat(MAX_LOCAL_PROJECT_BYTES + 1))).toThrow(/exceeds/);
    expect(() =>
      decodeLocalProject(`{"name":"unsafe","graphs":{},"engines":{"__proto__":{}},"constants":{}}`),
    ).toThrow(/forbidden key/);
  });

  it("removes secret-shaped engine fields and URL credentials from exports", () => {
    const store = makeLocalProjectStore(new MemoryStorage());
    store.importProject(
      encodeLocalProject({
        ...Project.empty(),
        engines: {
          imported: {
            password: "hidden",
            nested: { access_token: "hidden", url: "wss://user:pass@example.com/socket" },
          },
        },
      }),
    );

    const exported = JSON.parse(store.exportProject()) as {
      readonly project: { readonly engines: Record<string, unknown> };
    };
    expect(exported.project.engines).toEqual({
      imported: { nested: { url: "wss://example.com/socket" } },
    });
  });

  it("scrubs invalid-schema recovery but preserves valid legacy project storage", () => {
    const storage = new MemoryStorage();
    const key = "macrograph:local-project:local-browser";
    storage.setItem(key, JSON.stringify({ version: 1, project: { password: "recovery-secret" } }));
    makeLocalProjectStore(storage);
    expect(storage.getItem(`${key}:recovery`)).not.toContain("recovery-secret");

    storage.values.clear();
    const legacy = {
      ...Project.empty(),
      engines: { obs: { sockets: { "ws://localhost:4455": { password: "legacy-secret" } } } },
    };
    storage.setItem("macrograph:local-project", encodeLocalProject(legacy));
    const migrated = makeLocalProjectStore(storage);
    expect(storage.getItem(migrated.key)).toContain("legacy-secret");
  });

  it("persists OBS passwords through flush and reload while redacting explicit exports", async () => {
    const storage = new MemoryStorage();
    const store = makeLocalProjectStore(storage);
    await Effect.runPromise(
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        yield* persistence.saveProject({
          ...Project.empty(),
          engines: {
            obs: {
              sockets: {
                "ws://localhost:4455": {
                  password: "obs-secret",
                  connectOnStartup: true,
                },
              },
            },
          },
        });
        expect(JSON.stringify(yield* persistence.loadProject())).toContain("obs-secret");
      }).pipe(Effect.provide(store.layer), Effect.scoped),
    );
    store.flush();
    expect(storage.getItem(store.key)).toContain("obs-secret");
    const reloaded = makeLocalProjectStore(storage);
    await Effect.runPromise(
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        expect(JSON.stringify(yield* persistence.loadProject())).toContain("obs-secret");
      }).pipe(Effect.provide(reloaded.layer), Effect.scoped),
    );
    expect(store.exportProject()).not.toContain("obs-secret");
  });
});
