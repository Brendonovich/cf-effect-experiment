import type { UserOptions } from "@stylexjs/unplugin";

/**
 * StyleX options for module UI builds, kept in one place.
 *
 * Replicates `apps/server/client/vite.config.ts` until `@macrograph/vite-shared-libraries`
 * exports the canonical options (W4); swap this for that export once it lands. Token names
 * are hashed from paths relative to `rootDir`, so module and host must agree on it.
 */
export const options = (rootDir: string) =>
  ({
    sxPropName: false,
    useCSSLayers: { before: ["reset"], prefix: "stylex" },
    runtimeInjection: false,
    unstable_moduleResolution: { type: "commonJS", rootDir },
  }) satisfies Partial<UserOptions>;

export * as StyleX from "./StyleX.ts";
