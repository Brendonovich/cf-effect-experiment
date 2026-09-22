#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isUnexpectedConsoleProblem } from "./diagnostics.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../..");
const mode = process.argv[2] ?? "all";
const supportedModes = new Set([
  "doctor",
  "smoke",
  "function-navigation",
  "module-reference",
  "journey",
  "all",
]);
const interactionTimeout = Number(process.env.MACROGRAPH_VERIFY_INTERACTION_TIMEOUT ?? 10_000);
const uiTimeout = Number(process.env.MACROGRAPH_VERIFY_UI_TIMEOUT ?? 60_000);
const runId = process.env.MACROGRAPH_VERIFY_RUN_ID ?? new Date().toISOString().replaceAll(":", "-");
const outputDirectory = resolve(
  root,
  process.env.MACROGRAPH_VERIFY_OUTPUT ?? `tools/verify-macrograph/artifacts/${runId}`,
);
const manifest = {
  schemaVersion: 1,
  runId,
  mode,
  status: "running",
  startedAt: new Date().toISOString(),
  app: { name: "@macrograph/playground", url: null, port: null },
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    isolatedBrowserProfile: true,
  },
  checks: [],
  evidence: [],
  browser: { console: [], pageErrors: [], httpErrors: [], failedRequests: [] },
};

let appProcess;
let appLogHandle;
let appLogPath;
let context;
let profileDirectory;

function check(name, status, detail = undefined) {
  manifest.checks.push({ name, status, ...(detail === undefined ? {} : { detail }) });
  if (status === "failed") throw new Error(`${name}: ${detail ?? "failed"}`);
}

async function evidence(path, kind) {
  const contents = await readFile(path);
  const repositoryPath = relative(root, path);
  manifest.evidence.push({
    path: repositoryPath.startsWith("..") || isAbsolute(repositoryPath) ? path : repositoryPath,
    kind,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}

async function saveManifest() {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      `Playwright is unavailable. Add playwright as a root devDependency and run pnpm exec playwright install chromium. (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function doctor() {
  const pnpm = spawnSync("pnpm", ["--version"], { cwd: root, encoding: "utf8" });
  check(
    "Node.js >= 22",
    Number(process.versions.node.split(".")[0]) >= 22 ? "passed" : "failed",
    process.version,
  );
  check(
    "pnpm available",
    pnpm.status === 0 ? "passed" : "failed",
    pnpm.stdout.trim() || pnpm.stderr.trim(),
  );
  try {
    await access(join(root, "apps/playground/package.json"));
    check("playground app present", "passed", "apps/playground/package.json");
  } catch (error) {
    check(
      "playground app present",
      "failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  let chromium;
  try {
    ({ chromium } = await loadPlaywright());
    check("Playwright package available", "passed");
  } catch (error) {
    check(
      "Playwright package available",
      "failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  const executable = chromium.executablePath();
  try {
    await access(executable);
    check("Playwright Chromium installed", "passed", executable);
  } catch (error) {
    check(
      "Playwright Chromium installed",
      "failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function availablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string")
        return reject(new Error("Could not reserve a port"));
      server.close(() => resolvePort(address.port));
    });
  });
}

async function startApp() {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}/`;
  manifest.app = { ...manifest.app, port, url };
  appLogPath = join(outputDirectory, "playground.log");
  appLogHandle = await open(appLogPath, "w");
  appProcess = spawn(
    "pnpm",
    [
      "--filter",
      "@macrograph/playground",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: root,
      detached: process.platform !== "win32",
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", appLogHandle.fd, appLogHandle.fd],
    },
  );
  let spawnError;
  appProcess.once("error", (error) => {
    spawnError = error;
  });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (spawnError !== undefined) throw spawnError;
    if (appProcess.exitCode !== null)
      throw new Error(`Playground exited with code ${appProcess.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) {
        check("playground started on isolated port", "passed", url);
        return { url };
      }
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function openBrowser(url) {
  const { chromium } = await loadPlaywright();
  profileDirectory = await mkdtemp(join(tmpdir(), "macrograph-verify-profile-"));
  context = await chromium.launchPersistentContext(profileDirectory, {
    headless: process.env.MACROGRAPH_VERIFY_HEADED !== "1",
    viewport: { width: 1440, height: 960 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(interactionTimeout);
  page.on("console", (message) => {
    const location = message.location();
    const ignored = isUnavailableOpenCodePicker(location.url);
    manifest.browser.console.push({
      type: message.type(),
      text: message.text(),
      location,
      ...(ignored
        ? { ignored: true, reason: "OpenCode picker is unavailable in standalone verification" }
        : {}),
    });
  });
  page.on("pageerror", (error) => manifest.browser.pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const responseUrl = response.url();
      const ignored = isUnavailableOpenCodePicker(responseUrl);
      manifest.browser.httpErrors.push({
        status: response.status(),
        url: responseUrl,
        ...(ignored
          ? { ignored: true, reason: "OpenCode picker is unavailable in standalone verification" }
          : {}),
      });
    }
  });
  page.on("requestfailed", (request) => {
    manifest.browser.failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

function isUnavailableOpenCodePicker(url) {
  try {
    return new URL(url).pathname === "/__vite_opencode_picker";
  } catch {
    return false;
  }
}

async function waitForAppShell(page) {
  await page.getByRole("img", { name: "MacroGraph" }).waitFor();
  await page.getByRole("button", { name: "Export", exact: true }).waitFor();
}

async function smoke(page) {
  await waitForAppShell(page);
  await page.getByRole("button", { name: "New graph", exact: true }).waitFor();
  const path = join(outputDirectory, "smoke.png");
  await page.screenshot({ path, fullPage: true });
  await evidence(path, "screenshot");
  check("playground shell and editor are visible", "passed");
}

async function functionNavigation(page) {
  await waitForAppShell(page);
  await page.getByRole("button", { name: "Functions", exact: true }).click();
  await page.getByRole("button", { name: "New function", exact: true }).click();
  await page.getByRole("button", { name: "New Function", exact: true }).first().waitFor();
  await page.getByRole("region", { name: "Constants", exact: true }).waitFor();
  await page
    .getByRole("separator", { name: "Resize navigation and constants", exact: true })
    .waitFor();
  const path = join(outputDirectory, "function-navigation.png");
  await page.screenshot({ path, fullPage: true });
  await evidence(path, "screenshot");
  check("function navigation and split constants are visible", "passed");
}

async function moduleReference(page) {
  await waitForAppShell(page);
  await page.getByRole("button", { name: "Modules", exact: true }).click();
  await page.getByRole("button", { name: "Utilities", exact: true }).click();
  const moduleInfo = page.locator('[data-component="module-info"]');
  await moduleInfo.getByText("Module", { exact: true }).waitFor();
  await moduleInfo.getByText("Utilities", { exact: true }).waitFor();
  await moduleInfo
    .getByText("General-purpose control flow, formatting, timing, and debugging tools.", {
      exact: true,
    })
    .waitFor();
  const redundantTitleCount = await moduleInfo.getByText("Module Info", { exact: true }).count();
  check("focused module title omits Info", redundantTitleCount === 0 ? "passed" : "failed");
  check("focused module exposes module info in the inspector", "passed", "Utilities");
  await page.getByRole("tab", { name: "Reference", exact: true }).click();
  await page.getByRole("heading", { name: "Exec Nodes", exact: true }).waitFor();
  const referenceSearch = page.getByRole("searchbox", { name: "Search reference", exact: true });
  const referenceSidebar = page.locator("aside", { has: referenceSearch });
  await referenceSearch.pressSequentially("Concat");
  await page.getByRole("heading", { name: "Pure Nodes", exact: true }).waitFor();
  const unrelatedNode = referenceSidebar.getByRole("button", { name: "Print", exact: true });
  const unrelatedNodeVisible =
    (await unrelatedNode.count()) > 0 && (await unrelatedNode.first().isVisible());
  check(
    "module reference search filters exposed nodes",
    unrelatedNodeVisible ? "failed" : "passed",
  );
  await page.getByRole("button", { name: "Concat Strings", exact: true }).click();
  await page.getByRole("heading", { name: "Concat Strings", exact: true }).waitFor();
  await page.locator('[data-graph-node-id="module-reference-preview"]').waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Concat Strings", exact: true }).waitFor();
  const referencePreview = page.locator('[data-graph-node-id="module-reference-preview"]');
  await referencePreview.waitFor();
  await referencePreview.locator('[data-node-header="module-reference-preview"]').click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");
  const clipboard = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  const copiedReferenceNode = clipboard?.nodes?.[0];
  check(
    "selected module reference node copies as a pasteable fragment",
    clipboard?.format === "macrograph/nodes" &&
      clipboard?.version === 1 &&
      clipboard?.nodes?.length === 1 &&
      copiedReferenceNode?.name === "Concat Strings" &&
      copiedReferenceNode?.schema?.schema === "ConcatStrings"
      ? "passed"
      : "failed",
  );
  const persistedReferenceTab = await page
    .getByRole("tab", { name: "Reference", exact: true })
    .getAttribute("aria-selected");
  const persistedReferenceItem = await page
    .getByRole("button", { name: "Concat Strings", exact: true })
    .getAttribute("aria-pressed");
  const path = join(outputDirectory, "module-reference.png");
  await page.screenshot({ path, fullPage: true });
  await evidence(path, "screenshot");
  check("module reference groups, selects, and previews exposed nodes", "passed");
  check(
    "module view and reference selection persist with the pane",
    persistedReferenceTab === "true" && persistedReferenceItem === "true" ? "passed" : "failed",
  );
}

function graphEntries(projectExport) {
  const graphs = projectExport?.project?.graphs;
  if (graphs === null || typeof graphs !== "object" || Array.isArray(graphs)) return [];
  return Object.entries(graphs);
}

function graphName(graph) {
  return graph?.canvas?.name ?? graph?.name;
}

async function exportProject(page, filename) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  const path = join(outputDirectory, filename);
  await download.saveAs(path);
  await evidence(path, "project-export");
  return JSON.parse(await readFile(path, "utf8"));
}

async function persistenceExportJourney(page) {
  const journeyName = "Verification Journey Graph";
  await page.getByRole("button", { name: "Graphs", exact: true }).click();
  await page.getByRole("button", { name: "New graph", exact: true }).click();
  await page.getByText("No graphs yet.", { exact: true }).waitFor({ state: "hidden" });

  const createdExport = await exportProject(page, "created-project.json");
  const createdGraphs = graphEntries(createdExport);
  check(
    "graph created through UI",
    createdGraphs.length === 1 ? "passed" : "failed",
    `${createdGraphs.length} graphs exported`,
  );
  const originalName = graphName(createdGraphs[0][1]);
  check(
    "created graph has a visible name",
    typeof originalName === "string" && originalName.length > 0 ? "passed" : "failed",
  );

  await page
    .getByRole("button", { name: originalName, exact: true })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const nameInput = page.getByRole("textbox", { name: "Graph name", exact: true });
  await nameInput.fill(journeyName);
  await nameInput.press("Enter");
  await page.getByRole("button", { name: journeyName, exact: true }).first().waitFor();
  await page.waitForFunction((name) => {
    for (let index = 0; index < localStorage.length; index += 1) {
      const value = localStorage.getItem(localStorage.key(index) ?? "");
      if (value?.includes(name)) return true;
    }
    return false;
  }, journeyName);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: journeyName, exact: true })
    .first()
    .waitFor({ timeout: uiTimeout });
  check("renamed graph survives reload", "passed", journeyName);

  const finalExport = await exportProject(page, "persisted-project.json");
  const finalNames = graphEntries(finalExport).map(([, graph]) => graphName(graph));
  check(
    "export contains persisted graph",
    finalNames.includes(journeyName) ? "passed" : "failed",
    finalNames.join(", "),
  );

  page.once("dialog", (dialog) => dialog.accept());
  const resetNavigation = page.waitForEvent("framenavigated");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await resetNavigation;
  await page.getByText("No graphs yet.", { exact: true }).waitFor({ timeout: uiTimeout });
  const resetExport = await exportProject(page, "reset-project.json");
  check(
    "reset clears the local project",
    graphEntries(resetExport).length === 0 ? "passed" : "failed",
  );

  page.once("dialog", (dialog) => dialog.accept());
  const importNavigation = page.waitForEvent("framenavigated");
  await page
    .locator('input[type="file"]')
    .setInputFiles(join(outputDirectory, "persisted-project.json"));
  await importNavigation;
  await page
    .getByRole("button", { name: journeyName, exact: true })
    .first()
    .waitFor({ timeout: uiTimeout });
  const importedExport = await exportProject(page, "imported-project.json");
  const importedNames = graphEntries(importedExport).map(([, graph]) => graphName(graph));
  check(
    "import restores the exported project",
    importedNames.includes(journeyName) ? "passed" : "failed",
    importedNames.join(", "),
  );

  const path = join(outputDirectory, "persistence-export.png");
  await page.screenshot({ path, fullPage: true });
  await evidence(path, "screenshot");
}

async function cleanup() {
  if (context !== undefined) await context.close().catch(() => {});
  if (appProcess !== undefined && appProcess.exitCode === null) {
    const target = process.platform === "win32" ? appProcess.pid : -appProcess.pid;
    try {
      process.kill(target, "SIGTERM");
    } catch {}
    await Promise.race([
      new Promise((resolveExit) => appProcess.once("exit", resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
    ]);
    if (appProcess.exitCode === null) {
      try {
        process.kill(target, "SIGKILL");
      } catch {}
    }
  }
  if (appLogHandle !== undefined) {
    await appLogHandle.close().catch(() => {});
    appLogHandle = undefined;
  }
  if (profileDirectory !== undefined) await rm(profileDirectory, { recursive: true, force: true });
}

let handlingSignal = false;
async function handleSignal(signal) {
  if (handlingSignal) return;
  handlingSignal = true;
  manifest.status = "failed";
  manifest.error = { message: `Verification interrupted by ${signal}` };
  await cleanup();
  manifest.finishedAt = new Date().toISOString();
  await saveManifest();
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.once("SIGINT", () => void handleSignal("SIGINT"));
process.once("SIGTERM", () => void handleSignal("SIGTERM"));

async function main() {
  if (!supportedModes.has(mode))
    throw new Error(
      `Usage: verify.mjs [doctor|smoke|function-navigation|module-reference|journey|all]`,
    );
  await mkdir(outputDirectory, { recursive: true });
  await doctor();
  if (mode !== "doctor") {
    const { url } = await startApp();
    const page = await openBrowser(url);
    if (mode === "smoke" || mode === "all") await smoke(page);
    if (mode === "function-navigation" || mode === "all") await functionNavigation(page);
    if (mode === "module-reference" || mode === "all") await moduleReference(page);
    if (mode === "journey" || mode === "all") await persistenceExportJourney(page);
    const unexpectedConsoleProblems = manifest.browser.console.filter(isUnexpectedConsoleProblem);
    const unexpectedHttpErrors = manifest.browser.httpErrors.filter(
      (response) => response.ignored !== true,
    );
    check(
      "uncaught page errors",
      manifest.browser.pageErrors.length === 0 ? "passed" : "failed",
      manifest.browser.pageErrors.join("; "),
    );
    check(
      "unexpected console problems",
      unexpectedConsoleProblems.length === 0 ? "passed" : "failed",
      unexpectedConsoleProblems.map((message) => message.text).join("; "),
    );
    check(
      "unexpected HTTP errors",
      unexpectedHttpErrors.length === 0 ? "passed" : "failed",
      unexpectedHttpErrors.map((response) => `${response.status} ${response.url}`).join("; "),
    );
    check(
      "failed browser requests",
      manifest.browser.failedRequests.length === 0 ? "passed" : "failed",
      manifest.browser.failedRequests
        .map((request) => `${request.error} ${request.url}`)
        .join("; "),
    );
  }
  manifest.status = "passed";
}

try {
  await main();
} catch (error) {
  manifest.status = "failed";
  manifest.error =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error) };
  console.error(manifest.error.message);
  process.exitCode = 1;
} finally {
  await cleanup();
  if (appLogPath !== undefined) {
    try {
      await evidence(appLogPath, "server-log");
    } catch {}
  }
  manifest.finishedAt = new Date().toISOString();
  await saveManifest();
  console.log(`${manifest.status.toUpperCase()}: ${join(outputDirectory, "manifest.json")}`);
}
