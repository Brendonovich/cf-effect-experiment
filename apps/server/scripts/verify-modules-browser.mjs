#!/usr/bin/env node
// Drives the built production server in Chromium: built-in module settings load from
// `/module/.../ui/...` and call module RPCs over HTTP, and the modules admin view renders.
// Run after `MACROGRAPH_BASE_PATH=/macrograph pnpm build`. Writes screenshots and a report to
// MACROGRAPH_VERIFY_OUTPUT (default: tools/verify-macrograph/artifacts/server-modules-<time>).

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const appDirectory = resolve(import.meta.dirname, "..");
const basePath = process.env.MACROGRAPH_BASE_PATH ?? "/macrograph";
const output = resolve(
  process.env.MACROGRAPH_VERIFY_OUTPUT ??
    join(
      appDirectory,
      "../../tools/verify-macrograph/artifacts",
      `server-modules-${new Date().toISOString().replaceAll(":", "-")}`,
    ),
);
await mkdir(output, { recursive: true });

// A stand-in for the MacroGraph cloud that approves server setup immediately.
const cloud = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  const path = request.url?.split("?")[0];
  if (path === "/server/registration/start")
    response.end(
      JSON.stringify({
        id: "setup",
        userCode: "SETUP",
        verification_uri: "https://www.macrograph.app/connect",
        verification_uri_complete: "https://www.macrograph.app/connect?code=SETUP",
      }),
    );
  else if (path === "/server/registration" && request.method === "POST")
    response.end(JSON.stringify({ token: "cloud-registration-token" }));
  else if (path === "/server/registration") response.end(JSON.stringify({ ownerId: "owner" }));
  else if (path === "/user")
    response.end(JSON.stringify({ id: "owner", email: "owner@example.com" }));
  else if (path === "/credentials") response.end("[]");
  else {
    response.statusCode = 404;
    response.end("{}");
  }
});
await new Promise((resolveListen) => cloud.listen(0, "127.0.0.1", resolveListen));

const dataDirectory = await mkdtemp(join(tmpdir(), "macrograph-browser-"));
const child = spawn(process.execPath, ["dist/esm/index.js"], {
  cwd: appDirectory,
  env: {
    ...process.env,
    PORT: "0",
    HOST: "127.0.0.1",
    MACROGRAPH_DATA_DIR: dataDirectory,
    MACROGRAPH_BASE_PATH: basePath,
    MACROGRAPH_CLOUD_BASE_URL: `http://127.0.0.1:${cloud.address().port}`,
    OTEL_EXPORTER_OTLP_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stderr.on("data", (chunk) => (log += chunk));
const { port, setupKey } = await new Promise((resolveStart, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Server did not start:\n${log}`)), 20_000);
  child.stdout.on("data", (chunk) => {
    log += chunk;
    const port = /MACROGRAPH_LISTENING (\d+)/.exec(log)?.[1];
    const setupKey = /MACROGRAPH_SETUP_KEY ([\w-]+)/.exec(log)?.[1];
    if (port !== undefined && setupKey !== undefined) {
      clearTimeout(timeout);
      resolveStart({ port: Number(port), setupKey });
    }
  });
});
const origin = `http://127.0.0.1:${port}`;

const report = {
  origin,
  checks: [],
  console: [],
  pageErrors: [],
  cspViolations: [],
  moduleRequests: [],
};
const check = (name, passed, detail) => {
  report.checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

let browser;
let page;
try {
  const setup = (operation) =>
    fetch(`${origin}${basePath}/auth/setup/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: setupKey }),
    }).then((response) => response.json());
  await setup("start");
  const { token } = await setup("poll");
  if (typeof token !== "string") throw new Error("Setup did not return a session token");

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.addInitScript((session) => {
    localStorage.setItem("macrograph:self-hosted:session", session);
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  }, token);
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      report.console.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith(`${basePath}/module/`))
      report.moduleRequests.push(
        `${response.request().method()} ${url.pathname} ${response.status()}`,
      );
  });

  await page.goto(`${origin}${basePath}/`);
  await page.getByRole("button", { name: "Modules", exact: true }).click();
  await page.getByRole("button", { name: "Utilities", exact: true }).click();
  await page.getByRole("tab", { name: "Engine", exact: true }).click();
  await page
    .getByRole("heading", { name: "Tick engine", exact: true })
    .waitFor({ timeout: 20_000 });
  check(
    "utilities settings UI loads from its module URL",
    report.moduleRequests.some((line) =>
      /\/module\/macrograph\.app\/macrograph\/utilities\/ui\/[0-9a-f]{16}\/index\.js 200$/.test(
        line,
      ),
    ),
  );
  const engineStatus = page.getByRole("status").filter({ hasText: /^(Running|Stopped)$/ });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await engineStatus.filter({ hasText: "Stopped" }).waitFor();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await engineStatus.filter({ hasText: "Running" }).waitFor();
  check(
    "module RPCs go over HTTP and update runtime state",
    report.moduleRequests.some((line) =>
      line.startsWith("POST /macrograph/module/macrograph.app/macrograph/utilities/rpc 200"),
    ),
  );
  await page.screenshot({ path: join(output, "module-settings.png"), fullPage: true });

  await page.getByRole("banner").getByRole("button", { name: "Settings", exact: true }).click();
  const admin = page.getByRole("tab", { name: "Browse registries", exact: true });
  await admin.waitFor({ timeout: 20_000 });
  const list = page.getByRole("list", { name: "Modules", exact: true });
  await list.getByText("Utilities", { exact: true }).first().waitFor();
  await list.getByText("Twitch", { exact: true }).first().waitFor();
  await list.getByRole("button", { name: "Reload Utilities", exact: true }).waitFor();
  check(
    "modules admin view lists modules",
    true,
    `${await list.getByRole("listitem").count()} items`,
  );
  await page.locator("[data-modules-admin]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "modules-admin.png"), fullPage: true });

  // Disabling unloads the module: the catalog and the package list (PackagesChanged) update live.
  const utilitiesItem = list.getByRole("listitem").filter({ hasText: "macrograph/utilities" });
  const sidebarUtilities = page
    .getByRole("navigation")
    .or(page.locator("aside"))
    .getByRole("button", { name: "Utilities", exact: true });
  await utilitiesItem.getByRole("button", { name: "Disable", exact: true }).click();
  await utilitiesItem.getByText("Disabled", { exact: true }).waitFor();
  await sidebarUtilities.first().waitFor({ state: "detached", timeout: 10_000 });
  check("disabling a module updates the admin list and the editor's packages", true);
  await page.screenshot({ path: join(output, "module-disabled.png"), fullPage: true });
  await utilitiesItem.getByRole("button", { name: "Enable", exact: true }).click();
  await utilitiesItem.getByText("Loaded", { exact: true }).waitFor();
  await sidebarUtilities.first().waitFor({ timeout: 10_000 });
  check("re-enabling a module loads it again", true);

  report.cspViolations = await page.evaluate(() => window.__cspViolations);
  check("no CSP violations", report.cspViolations.length === 0, report.cspViolations.join("; "));
  check("no page errors", report.pageErrors.length === 0, report.pageErrors.join("; "));
} catch (error) {
  check("browser journey", false, String(error));
  await page?.screenshot({ path: join(output, "failure.png"), fullPage: true });
} finally {
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(output, "server.log"), log);
  await browser?.close();
  child.kill("SIGTERM");
  cloud.close();
  await rm(dataDirectory, { recursive: true, force: true });
  console.log(`Evidence: ${output}`);
  process.exitCode = report.checks.every((entry) => entry.passed) ? 0 : 1;
}
