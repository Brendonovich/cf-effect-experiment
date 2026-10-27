import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type * as BuildManifest from "../src/BuildManifest.ts";

import { ImportMap } from "../src/ImportMap.ts";

const run = promisify(execFile);
const packageDirectory = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const serverClient = join(repositoryRoot, "apps/server/client");
const viteBin = join(packageDirectory, "node_modules/vite/bin/vite.js");

const files = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
  );

const viteBuild = (cwd: string, args: ReadonlyArray<string>, env: Record<string, string>) =>
  run(process.execPath, [viteBin, "build", ...args], {
    cwd,
    env: { ...process.env, ...env, NODE_ENV: "production" },
    maxBuffer: 64 * 1024 * 1024,
  });

const readManifest = (outDirectory: string): BuildManifest.Model =>
  JSON.parse(readFileSync(join(outDirectory, ".macrograph/shared-libraries.json"), "utf8"));

const inlineImportMap = (outDirectory: string) => {
  const html = readFileSync(join(outDirectory, "index.html"), "utf8");
  const match = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  if (match?.[1] === undefined) throw new Error("index.html has no import map");
  return { html, text: match[1] };
};

/** Writes a module UI package into a directory outside the monorepo and builds it. */
const buildModule = async (options: {
  readonly name: string;
  readonly source: string;
  readonly outDirectory: string;
  readonly anchors?: boolean;
}) => {
  const root = join(temporary, options.name);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: options.name, type: "module" }));
  writeFileSync(join(root, "src/ui.ts"), options.source);
  // A published editor-ui with a different file layout than the monorepo's source package.
  const editorUi = join(root, "node_modules/@macrograph/editor-ui");
  mkdirSync(join(editorUi, "dist/lib"), { recursive: true });
  writeFileSync(
    join(editorUi, "package.json"),
    JSON.stringify({
      name: "@macrograph/editor-ui",
      type: "module",
      exports: { "./tokens.stylex": "./dist/lib/tokens.stylex.js" },
    }),
  );
  writeFileSync(join(editorUi, "dist/lib/tokens.stylex.js"), "export const colors = {};\n");
  await viteBuild(packageDirectory, ["--config", "test/fixtures/module/vite.config.ts"], {
    FIXTURE_ROOT: root,
    FIXTURE_OUT: options.outDirectory,
    FIXTURE_NO_ANCHORS: options.anchors === false ? "1" : "0",
  });
  const css = files(options.outDirectory).filter((file) => file.endsWith(".css"));
  return css.map((file) => relative(options.outDirectory, file));
};

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** Serves built clients under their base paths with the CSP the server would send. */
const serveStatic = (sites: Readonly<Record<string, string>>) =>
  createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?", 1)[0] ?? "/");
    const base = Object.keys(sites).find((prefix) => path.startsWith(prefix));
    const root = base === undefined ? undefined : sites[base];
    if (base === undefined || root === undefined) {
      response.statusCode = 404;
      response.end();
      return;
    }
    const manifest = readManifest(root);
    response.setHeader(
      "content-security-policy",
      [
        "default-src 'self'",
        `script-src ${["'self'", ...manifest.scriptSrc].join(" ")}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
      ].join("; "),
    );
    let file = join(root, path.slice(base.length));
    if (!file.startsWith(root) || !existsSync(file) || readdirSafe(file))
      file = join(root, "index.html");
    response.setHeader("content-type", contentTypes[extname(file)] ?? "application/octet-stream");
    response.end(readFileSync(file));
  });

const readdirSafe = (path: string) => {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
};

let temporary = "";
let server: Server;
let origin = "";
let browser: Browser;
let fixtureHost = "";
let serverHost = "";
let fixtureCss: ReadonlyArray<string> = [];
let unanchoredCss: ReadonlyArray<string> = [];
let serverModuleCss: ReadonlyArray<string> = [];

const fixtureModuleSource = `
import * as stylex from "@stylexjs/stylex";
import { Effect, Schema } from "effect";
import * as SchemaModule from "effect/Schema";
import { createRoot, createSignal } from "solid-js";

const styles = stylex.create({ top: { paddingTop: 7 } });

export const shared = {
  createRoot,
  createSignal,
  Effect,
  Schema,
  SchemaString: SchemaModule.String,
  props: stylex.props,
};
export const paddingTopClassName = stylex.props(styles.top).className;
`;

const serverModuleSource = `
import * as stylex from "@stylexjs/stylex";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { Effect } from "effect";
import { createSignal } from "solid-js";

const styles = stylex.create({ box: { backgroundColor: colors.gray2, color: colors.gray12 } });

export const shared = { createSignal, Effect, props: stylex.props };
export const boxClassName = stylex.props(styles.box).className;
`;

beforeAll(async () => {
  temporary = mkdtempSync(join(tmpdir(), "macrograph-shared-libraries-"));
  fixtureHost = join(temporary, "fixture-host");
  serverHost = join(temporary, "server-client");
  await Promise.all([
    viteBuild(packageDirectory, ["--config", "test/fixtures/host/vite.config.ts"], {
      FIXTURE_OUT: fixtureHost,
    }),
    viteBuild(serverClient, ["--outDir", serverHost, "--emptyOutDir"], {
      MACROGRAPH_BASE_PATH: "/mg/",
    }),
  ]);
  fixtureCss = await buildModule({
    name: "fixture-module",
    source: fixtureModuleSource,
    outDirectory: join(fixtureHost, "fixture-module"),
  });
  unanchoredCss = await buildModule({
    name: "unanchored-module",
    source: fixtureModuleSource,
    outDirectory: join(fixtureHost, "unanchored-module"),
    anchors: false,
  });
  serverModuleCss = await buildModule({
    name: "server-module",
    source: serverModuleSource,
    outDirectory: join(serverHost, "fixture-module"),
  });
  server = serveStatic({ "/host/": fixtureHost, "/mg/": serverHost });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No server address");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  if (temporary !== "" && process.env.KEEP_FIXTURES !== "1")
    rmSync(temporary, { recursive: true, force: true });
});

const openPage = async (url: string) => {
  const page = await browser.newPage();
  const violations: Array<string> = [];
  const errors: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const list: Array<string> = Reflect.get(window, "__cspViolations") ?? [];
      list.push(`${event.violatedDirective} ${event.blockedURI}`);
      Reflect.set(window, "__cspViolations", list);
    });
  });
  await page.goto(url);
  await page.waitForLoadState("load");
  violations.push(...((await page.evaluate(() => Reflect.get(window, "__cspViolations"))) ?? []));
  return { page, violations, errors };
};

const addStylesheets = (page: Page, hrefs: ReadonlyArray<string>) =>
  page.evaluate(
    (urls) =>
      Promise.all(
        urls.map(
          (href) =>
            new Promise<void>((done, fail) => {
              const link = document.createElement("link");
              link.rel = "stylesheet";
              link.href = href;
              link.onload = () => done();
              link.onerror = () => fail(new Error(`Failed to load ${href}`));
              document.head.append(link);
            }),
        ),
      ),
    [...hrefs],
  );

describe("shared libraries", () => {
  it("writes a build manifest whose hash matches the inline import map", () => {
    for (const outDirectory of [fixtureHost, serverHost]) {
      const manifest = readManifest(outDirectory);
      const { html, text } = inlineImportMap(outDirectory);
      expect(text).toBe(ImportMap.serialize(manifest.importMap));
      expect(manifest.scriptSrc).toEqual([ImportMap.cspSource(text)]);
      expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'));
      for (const file of manifest.files) {
        expect(file.startsWith("_shared/")).toBe(true);
        expect(existsSync(join(outDirectory, file))).toBe(true);
      }
    }
  });

  it("maps every shared specifier under the base path", () => {
    const imports = readManifest(serverHost).importMap.imports;
    for (const specifier of [
      "solid-js",
      "@solidjs/web",
      "effect",
      "effect/Schema",
      "effect/rpc",
      "@macrograph/module",
      "@macrograph/module/ModuleUI",
      "@macrograph/editor-ui",
      "@macrograph/editor-ui/tokens.stylex",
      "@tanstack/solid-query",
      "@stylexjs/stylex",
    ])
      expect(imports[specifier], specifier).toMatch(/^\/mg\/_shared\/[^/]+\//);
    expect(imports["@macrograph/module/vite"]).toBeUndefined();
    expect(Object.keys(imports).some((specifier) => specifier.includes("/internal/"))).toBe(false);
  });

  it("gives a separately built module the host's library instances", async () => {
    const { page, violations, errors } = await openPage(`${origin}/host/`);
    // A string, so Vitest leaves the browser's own dynamic import() alone.
    const result: unknown = await page.evaluate(`(async () => {
      const module = await import("/host/fixture-module/ui.js");
      const host = globalThis.macrographHost;
      return Object.fromEntries(
        ["createRoot", "createSignal", "Effect", "Schema", "SchemaString", "props"].map((key) => [
          key,
          module.shared[key] !== undefined && module.shared[key] === host[key],
        ]),
      );
    })()`);
    expect(result).toEqual({
      createRoot: true,
      createSignal: true,
      Effect: true,
      Schema: true,
      SchemaString: true,
      props: true,
    });
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("keeps StyleX priorities across the host and module stylesheets", async () => {
    // Both modules generate the same class name, so each is measured in its own page.
    const measure = async (name: string, css: ReadonlyArray<string>) => {
      const { page } = await openPage(`${origin}/host/`);
      await addStylesheets(
        page,
        css.map((file) => `/host/${name}/${file}`),
      );
      const paddingTop = await page.evaluate<string>(`(async () => {
        const host = globalThis.macrographHost;
        const module = await import("/host/${name}/ui.js");
        const element = document.createElement("div");
        // The module's longhand must beat the host's padding and paddingBlock shorthands.
        element.className = host.paddingClassName + " " + module.paddingTopClassName;
        document.body.append(element);
        return getComputedStyle(element).paddingTop;
      })()`);
      await page.close();
      return paddingTop;
    };
    expect(await measure("fixture-module", fixtureCss)).toBe("7px");
    // Without the layer anchors the module's layer names mean different priority levels.
    expect(await measure("unanchored-module", unanchoredCss)).toBe("2px");
  });

  it("loads module UI in the built server client with tokens and one instance of each library", async () => {
    const { page, violations } = await openPage(`${origin}/mg/`);
    expect(violations).toEqual([]);
    await addStylesheets(
      page,
      serverModuleCss.map((file) => `/mg/fixture-module/${file}`),
    );
    const result = await page.evaluate<Record<string, string | boolean>>(`(async () => {
      const module = await import("/mg/fixture-module/ui.js");
      const solid = await import("solid-js");
      const effect = await import("effect");
      const stylex = await import("@stylexjs/stylex");
      const box = document.createElement("div");
      box.className = module.boxClassName;
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--gray-2)";
      probe.style.color = "var(--gray-12)";
      document.body.append(box, probe);
      return {
        solid: module.shared.createSignal === solid.createSignal,
        effect: module.shared.Effect === effect.Effect,
        stylex: module.shared.props === stylex.props,
        background: getComputedStyle(box).backgroundColor,
        color: getComputedStyle(box).color,
        expectedBackground: getComputedStyle(probe).backgroundColor,
        expectedColor: getComputedStyle(probe).color,
      };
    })()`);
    expect(result.solid).toBe(true);
    expect(result.effect).toBe(true);
    expect(result.stylex).toBe(true);
    expect(result.expectedBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(result.background).toBe(result.expectedBackground);
    expect(result.color).toBe(result.expectedColor);
    await page.close();
  });
});
