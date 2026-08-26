import { Graph, Node, Project } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer, Option, Ref, Schema } from "effect";

export interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export type LocalProjectStatus =
  | { readonly type: "saved" }
  | { readonly type: "recovered"; readonly message: string }
  | { readonly type: "error"; readonly message: string };

const version = 1 as const;
const Envelope = Schema.Struct({ version: Schema.Literal(version), project: Project.Model });
const LegacyEnvelope = Schema.Struct({ version: Schema.Literal(0), project: Project.Model });

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const decodeLocalProject = (input: string): Project.Model => {
  if (new TextEncoder().encode(input).byteLength > MAX_LOCAL_PROJECT_BYTES)
    throw new Error(`Project file exceeds the ${MAX_LOCAL_PROJECT_BYTES} byte limit`);
  const parsed: unknown = JSON.parse(input);
  assertSafeJson(parsed);
  const current = Schema.decodeUnknownOption(Envelope)(parsed);
  if (Option.isSome(current)) return current.value.project;
  const legacyEnvelope = Schema.decodeUnknownOption(LegacyEnvelope)(parsed);
  if (Option.isSome(legacyEnvelope)) return legacyEnvelope.value.project;
  return Schema.decodeUnknownSync(Project.Model)(parsed);
};

export const encodeLocalProject = (project: Project.Model, pretty = false): string =>
  JSON.stringify(
    Schema.encodeUnknownSync(Envelope)({ version, project }),
    null,
    pretty ? 2 : undefined,
  );

export interface LocalProjectStore {
  readonly projectId: string;
  readonly key: string;
  readonly layer: Layer.Layer<Persistence.Service>;
  readonly exportProject: () => string;
  readonly importProject: (input: string) => Project.Model;
  readonly reset: () => boolean;
  readonly flush: () => void;
  readonly subscribe: (listener: (status: LocalProjectStatus) => void) => () => void;
}

export const MAX_LOCAL_PROJECT_BYTES = 5 * 1024 * 1024;

const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const secretKey =
  /^(?:access[-_]?token|api[-_]?key|authorization|password|refresh[-_]?token|secret|token)$/i;

const assertSafeJson = (value: unknown) => {
  const pending: Array<unknown> = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null) continue;
    if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry);
      continue;
    }
    for (const key of Object.keys(current)) {
      if (forbiddenKeys.has(key)) throw new Error(`Project data contains forbidden key ${key}`);
      pending.push(Object.getOwnPropertyDescriptor(current, key)?.value);
    }
  }
};

function sanitizeExportValue(value: Schema.Json, key?: string): Schema.Json {
  if (Array.isArray(value)) return value.map((entry) => sanitizeExportValue(entry));
  if (typeof value !== "object" || value === null) {
    if (typeof value !== "string" || key === undefined || !/url/i.test(key)) return value;
    try {
      const url = new URL(value);
      url.username = "";
      url.password = "";
      return url.href;
    } catch {
      return value;
    }
  }
  const sanitized: Record<string, Schema.Json> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (secretKey.test(entryKey)) continue;
    sanitized[entryKey] = sanitizeExportValue(entryValue, entryKey);
  }
  return sanitized;
}

function projectForExport(project: Project.Model): Project.Model {
  return {
    ...project,
    engines: Object.fromEntries(
      Object.entries(project.engines).map(([pluginId, state]) => [
        pluginId,
        sanitizeExportValue(state),
      ]),
    ),
  };
}

export const makeLocalProjectStore = (
  storage: StorageLike,
  options?: { readonly projectId?: string; readonly key?: string; readonly debounceMs?: number },
): LocalProjectStore => {
  const projectId = options?.projectId ?? "local-browser";
  const key = options?.key ?? `macrograph:local-project:${encodeURIComponent(projectId)}`;
  const legacyKey =
    options?.key === undefined && projectId === "local-browser"
      ? "macrograph:local-project"
      : undefined;
  const temporaryKey = `${key}:pending`;
  const recoveryKey = `${key}:recovery`;
  const debounceMs = options?.debounceMs ?? 150;
  const listeners = new Set<(status: LocalProjectStatus) => void>();
  let lastStatus: LocalProjectStatus | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  const notify = (status: LocalProjectStatus) => {
    lastStatus = status;
    for (const listener of listeners) listener(status);
  };
  const safelyRemove = (target: string) => {
    try {
      storage.removeItem(target);
      return true;
    } catch {
      // The in-memory project remains usable when browser storage is unavailable.
      return false;
    }
  };
  const quarantine = (target: string, raw: string) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      assertSafeJson(parsed);
      const json = Schema.decodeUnknownOption(Schema.Json)(parsed);
      storage.setItem(
        recoveryKey,
        Option.isSome(json)
          ? JSON.stringify(sanitizeExportValue(json.value))
          : JSON.stringify({ error: "Invalid local project data was not retained." }),
      );
    } catch {
      try {
        storage.setItem(
          recoveryKey,
          JSON.stringify({ error: "Malformed local project data was not retained." }),
        );
      } catch {
        // Recovery remains best effort when storage is full or blocked.
      }
    }
    safelyRemove(target);
  };
  const recover = (): Project.Model | undefined => {
    try {
      const pendingRaw = storage.getItem(temporaryKey);
      if (pendingRaw !== null) {
        let pending: Project.Model | undefined;
        try {
          pending = decodeLocalProject(pendingRaw);
        } catch (error) {
          quarantine(temporaryKey, pendingRaw);
          notify({
            type: "recovered",
            message: `Malformed interrupted save was isolated (${message(error)}).`,
          });
        }
        if (pending !== undefined) {
          try {
            storage.setItem(key, encodeLocalProject(pending));
            storage.removeItem(temporaryKey);
          } catch {
            // Keep the valid staging record for the next recovery attempt.
          }
          notify({ type: "recovered", message: "Recovered the last interrupted local save." });
          return pending;
        }
      }
      const committed = storage.getItem(key);
      const fromLegacy = committed === null && legacyKey !== undefined;
      const stored = committed ?? (fromLegacy ? storage.getItem(legacyKey) : null);
      if (stored === null) return undefined;
      try {
        const decoded = decodeLocalProject(stored);
        if (fromLegacy) {
          try {
            storage.setItem(key, encodeLocalProject(decoded));
            safelyRemove(legacyKey);
          } catch {
            // A decoded legacy project remains usable in memory when migration cannot persist.
          }
        }
        return decoded;
      } catch (error) {
        quarantine(fromLegacy && legacyKey !== undefined ? legacyKey : key, stored);
        dirty = true;
        notify({
          type: "recovered",
          message: `Malformed local data was isolated and a new project was opened (${message(error)}).`,
        });
        return undefined;
      }
    } catch (error) {
      notify({
        type: "error",
        message: `Local storage could not be read. Changes remain in this tab (${message(error)}).`,
      });
      return undefined;
    }
  };
  const state = Ref.makeUnsafe(recover() ?? Project.empty());

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!dirty) return;
    const encoded = encodeLocalProject(Ref.getUnsafe(state));
    try {
      storage.setItem(temporaryKey, encoded);
      storage.setItem(key, encoded);
      safelyRemove(temporaryKey);
      dirty = false;
      notify({ type: "saved" });
    } catch (error) {
      notify({
        type: "error",
        message: `Local save failed. Export the project before closing this tab (${message(error)}).`,
      });
    }
  };
  const schedule = () => {
    dirty = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };
  const layer = Layer.effect(
    Persistence.Service,
    Effect.gen(function* () {
      const update = (mutation: Persistence.ProjectMutation) =>
        Ref.modify(state, (current) => {
          const updated = Persistence.applyMutation(current, mutation);
          return Option.isSome(updated)
            ? ([true, updated.value] as const)
            : ([false, current] as const);
        }).pipe(Effect.tap((updated) => (updated ? Effect.sync(schedule) : Effect.void)));
      yield* Effect.addFinalizer(() => Effect.sync(flush));
      return Persistence.Service.of({
        saveProject: (next) => update({ _tag: "SaveProject", project: next }),
        loadProject: () => Ref.get(state),
        loadGraph: (graphId) =>
          Ref.get(state).pipe(
            Effect.flatMap((current) => {
              const graph = current.graphs[graphId];
              return graph === undefined
                ? new Graph.NotFoundError({ id: graphId })
                : Effect.succeed(graph);
            }),
          ),
        loadNode: (graphId, nodeId) =>
          Ref.get(state).pipe(
            Effect.flatMap((current) => {
              const node = current.graphs[graphId]?.nodes[nodeId];
              return node === undefined
                ? new Node.NotFoundError({ id: nodeId })
                : Effect.succeed(node);
            }),
          ),
        saveGraph: (graph) => update({ _tag: "SaveGraph", graph }),
        deleteGraph: (graphId) => update({ _tag: "DeleteGraph", graphId }),
        saveNode: (graphId, node) => update({ _tag: "SaveNode", graphId, node }),
        deleteNode: (graphId, nodeId) => update({ _tag: "DeleteNode", graphId, nodeId }),
        saveConnection: (graphId, connection) =>
          update({ _tag: "SaveConnection", graphId, connection }),
        deleteConnection: (graphId, connectionId) =>
          update({ _tag: "DeleteConnection", graphId, connectionId }),
      });
    }),
  );

  return {
    projectId,
    key,
    layer,
    exportProject: () => {
      flush();
      return encodeLocalProject(projectForExport(Ref.getUnsafe(state)), true);
    },
    importProject: (input) => {
      const project = decodeLocalProject(input);
      const previous = Ref.getUnsafe(state);
      Effect.runSync(Ref.set(state, project));
      dirty = true;
      flush();
      if (dirty) {
        Effect.runSync(Ref.set(state, previous));
        safelyRemove(temporaryKey);
        schedule();
        throw new Error("The imported project could not be saved to local storage");
      }
      return project;
    },
    reset: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const targets = [key, temporaryKey, recoveryKey, legacyKey].filter(
        (target): target is string => target !== undefined,
      );
      const previous = new Map<string, string>();
      try {
        for (const target of targets) {
          const value = storage.getItem(target);
          if (value !== null) previous.set(target, value);
        }
      } catch {
        notify({
          type: "error",
          message: "Local storage could not be read. The current project was kept.",
        });
        return false;
      }
      const removed = targets.map(safelyRemove).every(Boolean);
      if (!removed) {
        for (const [target, value] of previous) {
          try {
            storage.setItem(target, value);
          } catch {
            // The error status below remains actionable if rollback is blocked too.
          }
        }
        schedule();
        notify({
          type: "error",
          message: "Local storage could not be cleared. The current project was kept.",
        });
        return false;
      }
      Effect.runSync(Ref.set(state, Project.empty()));
      dirty = false;
      return removed;
    },
    flush,
    subscribe: (listener) => {
      listeners.add(listener);
      if (lastStatus !== undefined) listener(lastStatus);
      return () => listeners.delete(listener);
    },
  };
};
