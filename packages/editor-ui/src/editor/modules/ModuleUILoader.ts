import type { ClientSettings } from "@macrograph/module/ClientSettings";
import type { ModuleUI } from "@macrograph/module/ModuleUI";
import type { JSX } from "@solidjs/web";

import type { ModuleCatalogEntry } from "./ModuleCatalogSource";

export type ModuleUIDescriptor = ModuleUI.Descriptor<JSX.Element>;

/** A bundled module UI: the descriptor itself, or a bundler `import()` of its UI entry. */
export type StaticModuleUI =
  | ModuleUIDescriptor
  | (() => Promise<ModuleUIDescriptor | { readonly default: ModuleUIDescriptor }>);

/** A loaded module UI. Holding it keeps the module's stylesheets in the document. */
export interface ModuleUIHandle {
  readonly descriptor: Promise<ModuleUIDescriptor>;
  /** Removes this handle's hold on the module's stylesheets. Safe to call more than once. */
  readonly release: () => void;
}

export interface ModuleUILoader {
  /**
   * Identifies the code a load of the entry imports, or `undefined` when the module has no UI the
   * loader can load. A new key means the module's UI must be imported again.
   */
  readonly key: (entry: ModuleCatalogEntry) => string | undefined;
  /** Loads the module's UI lazily and injects its stylesheets until the handle is released. */
  readonly acquire: (entry: ModuleCatalogEntry) => ModuleUIHandle | undefined;
}

export class ModuleUILoadError extends Error {
  readonly moduleId: string;
  constructor(moduleId: string, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "ModuleUILoadError";
    this.moduleId = moduleId;
  }
}

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null;

const isSettings = (value: unknown): value is ClientSettings.Descriptor<JSX.Element> =>
  isRecord(value) &&
  "initial" in value &&
  typeof value.connect === "function" &&
  isRecord(value.connectInProcess);

/** Checks the shape of a module UI entry's default export. */
export const isDescriptor = (value: unknown): value is ModuleUIDescriptor =>
  isRecord(value) && (value.settings === undefined || isSettings(value.settings));

const defaultExport = (value: unknown) =>
  isRecord(value) && "default" in value ? value.default : value;

/** Reference-counted `<link rel="stylesheet">` elements, keyed by URL. */
export function createStylesheets(document: Document = globalThis.document) {
  const links = new Map<string, { readonly element: HTMLLinkElement; count: number }>();
  return {
    acquire(urls: ReadonlyArray<string>) {
      for (const url of urls) {
        const existing = links.get(url);
        if (existing !== undefined) {
          existing.count++;
          continue;
        }
        const element = document.createElement("link");
        element.rel = "stylesheet";
        element.href = url;
        element.dataset.macrographModuleStyle = "";
        document.head.append(element);
        links.set(url, { element, count: 1 });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const url of urls) {
          const link = links.get(url);
          if (link === undefined || --link.count > 0) continue;
          link.element.remove();
          links.delete(url);
        }
      };
    },
    /** URLs currently injected, for diagnostics and tests. */
    active: () => [...links.keys()],
  };
}

export type Stylesheets = ReturnType<typeof createStylesheets>;

export interface ModuleUILoaderOptions {
  /** Bundled UIs keyed by module id. Used when the catalog entry has no UI URL. */
  readonly static?: ReadonlyMap<string, StaticModuleUI>;
  /**
   * Imports UI entries from the catalog's URLs. Omit to load only bundled UIs. Defaults to a native
   * `import()` when set to `true`.
   */
  readonly url?: boolean | ((url: string) => Promise<unknown>);
  /** Resolves relative catalog URLs. Defaults to the document's base URI. */
  readonly baseUrl?: string;
  readonly stylesheets?: Stylesheets;
}

const importUrl = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

/**
 * Lazily loads module UIs, from catalog URLs on server builds or from bundled loaders.
 * A module's code is imported once per key; older code stays in memory until the page reloads.
 */
export function createModuleUILoader(options: ModuleUILoaderOptions = {}): ModuleUILoader {
  const importer =
    options.url === undefined || options.url === false
      ? undefined
      : options.url === true
        ? importUrl
        : options.url;
  const resolveUrl = (url: string) => {
    const base = options.baseUrl ?? globalThis.document?.baseURI;
    return base === undefined ? url : new URL(url, base).href;
  };
  let stylesheets = options.stylesheets;
  const loads = new Map<string, Promise<ModuleUIDescriptor>>();

  const source = (entry: ModuleCatalogEntry) => {
    if (importer !== undefined && entry.ui !== undefined) {
      const entryUrl = resolveUrl(entry.ui.entryUrl);
      const styleUrls = entry.ui.styleUrls.map(resolveUrl);
      return {
        key: `url:${entryUrl}`,
        styleUrls,
        load: () => importer(entryUrl),
      };
    }
    const bundled = options.static?.get(entry.id);
    if (bundled === undefined) return undefined;
    return {
      key: `static:${entry.id}`,
      styleUrls: [],
      load: () => (typeof bundled === "function" ? bundled() : Promise.resolve(bundled)),
    };
  };

  const load = (entry: ModuleCatalogEntry, resolved: NonNullable<ReturnType<typeof source>>) => {
    const cached = loads.get(resolved.key);
    if (cached !== undefined) return cached;
    const pending = Promise.resolve()
      .then(resolved.load)
      .then(
        (loaded) => {
          const descriptor = defaultExport(loaded);
          if (!isDescriptor(descriptor))
            throw new ModuleUILoadError(
              entry.id,
              `The UI of ${entry.displayName} does not export a module UI descriptor`,
            );
          return descriptor;
        },
        (cause: unknown) => {
          throw new ModuleUILoadError(entry.id, `Failed to load the UI of ${entry.displayName}`, {
            cause,
          });
        },
      );
    loads.set(resolved.key, pending);
    // Let a later acquire retry after a failure, such as a transient network error.
    pending.catch(() => {
      if (loads.get(resolved.key) === pending) loads.delete(resolved.key);
    });
    return pending;
  };

  return {
    key: (entry) => source(entry)?.key,
    acquire(entry) {
      const resolved = source(entry);
      if (resolved === undefined) return undefined;
      stylesheets ??= createStylesheets();
      const release = stylesheets.acquire(resolved.styleUrls);
      return { descriptor: load(entry, resolved), release };
    },
  };
}

/** Bundled loaders from `{ id, settings }` entries, such as `virtual:macrograph-module-settings`. */
export const staticSettings = (
  entries: ReadonlyArray<{
    readonly id: string;
    readonly settings: NonNullable<ModuleUIDescriptor["settings"]>;
  }>,
): ReadonlyMap<string, StaticModuleUI> =>
  new Map(entries.map((entry) => [entry.id, { settings: entry.settings }] as const));
