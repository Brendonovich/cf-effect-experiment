import type * as ModuleId from "../ModuleId.ts";

let unboundSequence = 0;

/**
 * A service key derived from the module id a definition is mounted under. The key is fixed the
 * first time it is read; definitions used before they are bound (e.g. in unit tests) get a
 * process-unique placeholder key instead and can no longer be bound.
 */
export const make = (format: (scope: string) => string) => {
  let bound: ModuleId.Id | undefined;
  let key: string | undefined;
  return {
    key: () => (key ??= format(bound ?? `unbound/${unboundSequence++}`)),
    bind: (moduleId: ModuleId.Id) => {
      if (bound === moduleId) return;
      if (bound !== undefined)
        throw new Error(`Definition is already bound to module ${bound}, not ${moduleId}`);
      if (key !== undefined)
        throw new Error(`Definition was used as ${key} before it was bound to ${moduleId}`);
      bound = moduleId;
    },
  };
};

/** Makes `target.key` read from a bound key. */
export const install = (target: object, key: () => string) =>
  Object.defineProperty(target, "key", { get: key, configurable: true, enumerable: true });
