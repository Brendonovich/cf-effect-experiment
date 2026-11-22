import { ModulePackage } from "@macrograph/module/ModulePackage";
import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import { stylexProps } from "@macrograph/module/vite";
import { layerAnchors, stylexOptions } from "@macrograph/vite-shared-libraries/StyleX";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { basename, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { build as viteBuild, type Plugin as VitePlugin, type Rolldown } from "vite";

export interface Options {
  readonly packageDirectory: string;
  readonly entry: string;
  readonly outDirectory: string;
  readonly minify: boolean;
}

/** What a UI build reports back: the module ids in its output chunks. */
export interface Output {
  readonly moduleIds: ReadonlyArray<string>;
}

const stylesFile = basename(ModulePackage.UiStyles);

const cssAssets = (bundle: Rolldown.OutputBundle) =>
  Object.values(bundle).flatMap((item) =>
    item.type === "asset" && item.fileName.endsWith(".css") ? [item] : [],
  );

/**
 * Collects every stylesheet, including StyleX's extracted CSS, into `ui/styles.css`. StyleX
 * only appends to a CSS asset that exists during `generateBundle`, so a placeholder is emitted
 * first; otherwise it writes a stray `assets/stylex.css` after the bundle is written.
 */
const uiStyles = (): VitePlugin => ({
  name: "macrograph-module-ui-styles",
  generateBundle: {
    order: "pre",
    handler(_options, bundle) {
      if (cssAssets(bundle).length === 0)
        this.emitFile({ type: "asset", fileName: "macrograph-styles-placeholder.css", source: "" });
    },
  },
});

const mergeUiStyles = (): VitePlugin => ({
  name: "macrograph-module-ui-styles-merge",
  enforce: "post",
  generateBundle: {
    order: "post",
    handler(_options, bundle) {
      const assets = cssAssets(bundle);
      const source = assets
        .map((asset) =>
          typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source),
        )
        .filter((css) => css.trim() !== "")
        .join("\n");
      for (const asset of assets) delete bundle[asset.fileName];
      if (source !== "") this.emitFile({ type: "asset", fileName: stylesFile, source });
    },
  },
});

/**
 * Builds a module's UI in the current thread. `@stylexjs/unplugin` keeps rules in a
 * thread-global store that isn't cleared between builds, so use {@link isolated} unless the
 * thread builds nothing else.
 */
export const run = async (options: Options): Promise<Output> => {
  const result = await viteBuild({
    configFile: false,
    root: options.packageDirectory,
    mode: "production",
    logLevel: "warn",
    publicDir: false,
    css: { postcss: { plugins: [] } },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [
      uiStyles(),
      stylexProps(),
      layerAnchors(),
      stylex.vite(stylexOptions()),
      solid(),
      mergeUiStyles(),
    ],
    build: {
      outDir: options.outDirectory,
      emptyOutDir: true,
      copyPublicDir: false,
      target: "esnext",
      minify: options.minify,
      sourcemap: false,
      cssCodeSplit: false,
      reportCompressedSize: false,
      lib: {
        entry: resolve(options.packageDirectory, options.entry),
        formats: ["es"],
        fileName: () => basename(ModulePackage.UiEntry),
        cssFileName: basename(ModulePackage.UiStyles, ".css"),
      },
      rolldownOptions: {
        external: (id: string) => SharedLibraries.isShared(id, "browser"),
        output: {
          chunkFileNames: "[name]-[hash].js",
          assetFileNames: "[name]-[hash][extname]",
        },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(
    (item: Rolldown.RolldownOutput | unknown) =>
      typeof item === "object" && item !== null && "output" in item
        ? (item as Rolldown.RolldownOutput).output
        : [],
  );
  return { moduleIds: outputs.flatMap((item) => (item.type === "chunk" ? item.moduleIds : [])) };
};

export type WorkerResult =
  | { readonly ok: true; readonly output: Output }
  | { readonly ok: false; readonly error: string };

const workerFile = new URL("./UiWorker.ts", import.meta.url);

/**
 * Builds a module's UI in its own worker thread, so StyleX's global rule store only ever
 * holds this module's rules and its stylesheet can't pick up another module's CSS.
 */
export const isolated = (options: Options) =>
  new Promise<Output>((done, fail) => {
    const worker = new Worker(workerFile, { workerData: options });
    let settled = false;
    worker.once("message", (message: WorkerResult) => {
      settled = true;
      if (message.ok) done(message.output);
      else fail(new Error(message.error));
    });
    worker.once("error", (error) => {
      settled = true;
      fail(error);
    });
    worker.once("exit", (code) => {
      if (!settled) fail(new Error(`UI build worker exited with code ${code}`));
    });
  });

export * as UiBuild from "./UiBuild.ts";
