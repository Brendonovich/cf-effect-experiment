import { createHash } from "node:crypto";

/** A browser import map: https://html.spec.whatwg.org/multipage/webappapis.html#import-maps */
export interface Model {
  readonly imports: Readonly<Record<string, string>>;
}

export const make = (imports: Readonly<Record<string, string>>): Model => ({
  imports: Object.fromEntries(Object.entries(imports).sort(([a], [b]) => (a < b ? -1 : 1))),
});

/** The exact text placed inside the inline `<script type="importmap">`. */
export const serialize = (map: Model) => JSON.stringify(map);

/** The CSP source that allows an inline script with this exact text, e.g. `'sha256-...'`. */
export const cspSource = (scriptText: string) =>
  `'sha256-${createHash("sha256").update(scriptText, "utf8").digest("base64")}'`;

export * as ImportMap from "./ImportMap.ts";
