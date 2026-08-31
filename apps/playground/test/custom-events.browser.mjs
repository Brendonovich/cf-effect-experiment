import assert from "node:assert/strict";
// Run against a production preview with Playwright available in NODE_PATH:
// NODE_PATH=/path/to/node_modules node test/custom-events.browser.mjs
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.MACROGRAPH_TEST_URL ?? "http://127.0.0.1:4185");
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await page.getByLabel("Event name", { exact: true }).fill("Greeting");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  await page.getByLabel("Field name", { exact: true }).fill("Message");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await page.getByRole("button", { name: "Edit Greeting", exact: true }).waitFor();
  await page.getByRole("button", { name: "Graphs", exact: true }).click();
  await page.getByRole("button", { name: "New graph", exact: true }).click();
  const canvas = page.locator("[data-active-graph-canvas]");
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  const create = async (name, x, y) => {
    await page.mouse.click(box.x + x, box.y + y, { button: "right" });
    await page.getByLabel("Search nodes", { exact: true }).fill(name);
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByLabel("Search nodes", { exact: true }).waitFor({ state: "hidden" });
  };
  await create("Tick", 100, 150);
  await create("Emit Greeting", 400, 150);
  await create("On Greeting", 100, 400);
  await create("Print", 400, 400);
  await page.getByLabel("Message", { exact: true }).fill("Hello from a custom event");
  await page.getByLabel("Message", { exact: true }).press("Tab");
  await page.waitForFunction(() => {
    const saved = localStorage.getItem("macrograph:local-project:local-browser");
    return (
      saved && Object.values(Object.values(JSON.parse(saved).project.graphs)[0].nodes).length === 4
    );
  });
  const readProject = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("macrograph:local-project:local-browser")).project,
    );
  const project = await readProject();
  const nodes = Object.values(Object.values(project.graphs)[0].nodes);
  const id = (schema) => nodes.find((node) => node.schema.schema === schema).id;
  const event = Object.values(project.customEvents)[0];
  const wire = async (from, out, to, input) => {
    const a = await page
      .locator(`[data-node-id="${from}"][data-io-id="${out}"][data-io-direction="output"]`)
      .boundingBox();
    const b = await page
      .locator(`[data-node-id="${to}"][data-io-id="${input}"][data-io-direction="input"]`)
      .boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
  };
  await wire(id("Tick"), "exec", id(`emit:${event.id}`), "exec");
  await wire(id(`on:${event.id}`), "exec", id("Print"), "exec");
  await wire(id(`on:${event.id}`), `field:${event.fields[0].id}`, id("Print"), "in");
  const workspace = page.getByRole("navigation", { name: "Workspace" });
  await workspace.getByRole("button", { name: "events", exact: true }).click();
  await page.getByText("Greeting", { exact: true }).first().click();
  await page.getByText("Hello from a custom event", { exact: false }).first().waitFor();
  await page.getByText("nodes complete", { exact: true }).waitFor();
  await page.reload();
  await canvas.waitFor();
  const restored = await readProject();
  assert.deepEqual(restored.customEvents, project.customEvents);
  const restoredGraph = Object.values(restored.graphs)[0];
  assert.equal(restoredGraph.connections.length, 3);
  assert.equal(
    restoredGraph.nodes[id(`emit:${event.id}`)].inputDefaults[`field:${event.fields[0].id}`],
    "Hello from a custom event",
  );
  await workspace.getByRole("button", { name: "events", exact: true }).click();
  await page.getByText("Greeting", { exact: true }).first().click();
  await page.getByText("nodes complete", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: author, typed Emit/On creation, delivery, completed handler, persisted reload, delivery after reload",
  );
} finally {
  await browser.close();
}
