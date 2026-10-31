import type * as ImportMap from "./ImportMap.ts";

/**
 * Written to `<outDir>/.macrograph/shared-libraries.json` by a production build. The leading dot
 * keeps it out of reach of the server's static file routes, which reject dot segments.
 *
 * The server reads `scriptSrc` and appends it to the `script-src` directive of its CSP so the
 * inline import map in `index.html` is allowed to run.
 */
export interface Model {
  readonly version: 1;
  /** The import map exactly as inlined into `index.html`. */
  readonly importMap: ImportMap.Model;
  /** CSP sources for the inline import map, e.g. `["'sha256-...'"]`. */
  readonly scriptSrc: ReadonlyArray<string>;
  /** Shared library files relative to the output directory, e.g. `_shared/<hash>/effect.js`. */
  readonly files: ReadonlyArray<string>;
}

/** Path of the manifest relative to the client output directory. */
export const file = ".macrograph/shared-libraries.json";

/** Directory, relative to the output directory and `base`, holding shared library modules. */
export const sharedDirectory = "_shared";

export * as BuildManifest from "./BuildManifest.ts";
