import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const key = "macrograph:local-project:local-browser";
const scope = 'variant:"Found"';
const field = 'field:"value"';
const node = (id, pkg, schema, x, y, properties = {}, inputDefaults = {}) => ({
  id, name: id === "match" ? "Match Enum" : id === "print" ? "Print" : "Tick",
  schema: { package: pkg, schema }, position: { x, y }, properties, inputDefaults, foldPins: false,
});
const fixture = {
  name: "Inline scopes", engines: {}, constants: {},
  types: { result: { _tag: "Enum", id: "result", name: "Result", variants: [
    { name: "Found", fields: [{ name: "value", type: { _tag: "String" } }] },
    { name: "Variant 2", fields: [{ name: "field2", type: { _tag: "String" } }] },
    { name: "Empty", fields: [] },
  ] } },
  graphs: { demo: { id: "demo", name: "Demo", nodes: {
    tick: node("tick", "util", "Tick", 40, 40),
    match: node("match", "CustomTypes", "MatchEnum", 260, 100, { type: "result" }, { value: { _type: "result", _tag: "Found", value: "inline scope works" } }),
    print: node("print", "util", "Print", 580, 150),
  }, connections: [{ id: "enter", outNodeId: "tick", outIo: { _tag: "Port", id: "exec" }, inNodeId: "match", inIoId: "exec" }] } },
};
const pin = (page, node, direction, id) => page.locator(`[data-node-id=${JSON.stringify(node)}][data-io-direction=${JSON.stringify(direction)}][data-io-id=${JSON.stringify(id)}]`);
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project, key);
const connect = async (page, source, target) => {
  const a = await source.boundingBox(), b = await target.boundingBox();
  assert(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
};
const waitConnections = (page, count) => page.waitForFunction(({ key, count }) => JSON.parse(localStorage.getItem(key)).project.graphs.demo.connections.length === count, { key, count });

export async function inlineScopes(context) {
  await context.addInitScript(({ key, fixture }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, project: fixture }));
  }, { key, fixture });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], logs = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    logs.push(message.text());
    if (message.text().includes("STRICT_READ_UNTRACKED")) errors.push(message.text());
  });
  try {
    await page.goto(process.env.PLAYGROUND_URL ?? "http://127.0.0.1:4315");
    await page.getByRole("button", { name: "Demo", exact: true }).first().click();
    const bundled = () => pin(page, "match", "output", JSON.stringify(["Port", scope]));
    const exec = () => pin(page, "match", "output", JSON.stringify(["ScopeExec", scope]));
    const value = () => pin(page, "match", "output", JSON.stringify(["ScopeField", scope, field]));
    const inputPositions = () => page.locator('[data-graph-node-id="match"] [data-io-direction="input"]').evaluateAll((pins) => pins.map((pin) => {
      const rect = pin.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }));
    await bundled().waitFor();
    const initialInputs = await inputPositions();
    await bundled().click({ button: "right" });
    await page.getByRole("button", { name: "Split scope", exact: true }).click();
    await exec().waitFor();
    await value().waitFor();
    assert.equal(await exec().getAttribute("data-io-kind"), "execution");
    assert.equal(await value().getAttribute("data-io-kind"), "data");
    assert.equal(await page.locator('[data-graph-node-id="match"] [data-scope-group]').count(), 1);
    assert.equal(await page.locator('[data-graph-node-id="match"] [data-scope-group]').first().evaluate((element) => getComputedStyle(element).borderLeftWidth), "1px");
    assert.equal(Object.keys((await saved(page)).graphs.demo.nodes).length, 3);
    await connect(page, exec(), pin(page, "print", "input", "exec"));
    await waitConnections(page, 2);
    await connect(page, value(), pin(page, "print", "input", "in"));
    await waitConnections(page, 3);
    if (!logs.some((text) => text.includes("inline scope works")))
      await page.waitForEvent("console", { predicate: (message) => message.text().includes("inline scope works") });
    const project = await saved(page);
    assert.deepEqual(project.graphs.demo.nodes.match.splitScopeOutputs, [scope]);
    assert.deepEqual(project.graphs.demo.connections.filter((wire) => wire.outNodeId === "match").map((wire) => wire.outIo), [
      { _tag: "ScopeExec", scope }, { _tag: "ScopeField", scope, field },
    ]);
    // Each scope is one bordered wrapper in the independent output column.
    const secondScope = 'variant:"Variant 2"';
    await pin(page, "match", "output", JSON.stringify(["Port", secondScope])).click({ button: "right" });
    await page.getByRole("button", { name: "Split scope", exact: true }).click();
    const secondExec = () => pin(page, "match", "output", JSON.stringify(["ScopeExec", secondScope]));
    await secondExec().waitFor();
    const borders = await page.locator('[data-graph-node-id="match"] [data-scope-group]').evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { tag: element.tagName, rows: element.querySelectorAll(':scope > [data-io-row="output"]').length, position: style.position, scope: element.getAttribute("data-scope-group"), left: style.borderLeftWidth, top: style.borderTopWidth, bottom: style.borderBottomWidth, x: rect.x, y: rect.y, end: rect.bottom, color: style.borderLeftColor, fill: style.backgroundColor, radiusTop: style.borderTopLeftRadius, radiusBottom: style.borderBottomLeftRadius, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, paddingLeft: style.paddingLeft };
    }));
    assert.equal(borders.length, 2);
    for (const border of borders) {
      assert.equal(border.tag, "DIV");
      assert.equal(border.rows, 2);
      assert.notEqual(border.position, "absolute");
      assert.equal(border.left, "1px");
      assert.equal(border.top, "1px");
      assert.equal(border.bottom, "1px");
      assert.equal(border.color, "rgb(85, 85, 95)");
      assert.equal(border.fill, "rgba(0, 0, 0, 0)");
      assert.equal(border.radiusTop, "5px");
      assert.equal(border.radiusBottom, "5px");
      assert.equal(border.paddingTop, "6px");
      assert.equal(border.paddingBottom, "6px");
      assert.equal(border.paddingLeft, "10px");
    }
    assert.equal(borders[0].x, borders[1].x, "Scope widths must be aligned");
    assert.equal(borders[1].y - borders[0].end, 8, "Scope gap must be 8px");
    assert.deepEqual(await inputPositions(), initialInputs, "Output groups must not move input pins");
    const columns = page.locator('[data-graph-node-id="match"] [data-io-column]');
    assert.equal(await columns.count(), 2);
    assert.deepEqual(await columns.evaluateAll((columns) => columns.map((column) => [...column.querySelectorAll('[data-io-row]')].map((row) => row.querySelectorAll('[data-io-direction]').length))), [[1, 1], [1, 1, 1, 1, 1]]);
    // Wire paths animate when expanding a wider group; assert after geometry settles.
    await page.waitForFunction((ids) => {
      const starts = [...document.querySelectorAll('[data-active-graph-canvas] svg path[stroke-width="2"]')].map((path) => {
        const point = path.getPointAtLength(0);
        return new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
      });
      return ids.every((id) => {
        const pin = [...document.querySelectorAll('[data-node-id="match"][data-io-direction="output"]')].find((element) => element.getAttribute("data-io-id") === id);
        if (!pin) return false;
        const bounds = pin.getBoundingClientRect();
        return starts.some((point) => Math.abs(point.x - (bounds.x + bounds.width / 2)) < 1 && Math.abs(point.y - (bounds.y + bounds.height / 2)) < 1);
      });
    }, [JSON.stringify(["ScopeExec", scope]), JSON.stringify(["ScopeField", scope, field])]);
    if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
    await secondExec().click({ button: "right" });
    await page.getByRole("button", { name: "Bundle scope", exact: true }).click();
    await pin(page, "match", "output", JSON.stringify(["Port", secondScope])).waitFor();
    await value().click({ button: "right" });
    assert.equal(await page.getByRole("button", { name: "Bundle scope", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");
    await page.reload();
    await value().waitFor();
    assert.equal(Object.keys((await saved(page)).graphs.demo.nodes).length, 3);
    await value().dblclick();
    await waitConnections(page, 2);
    await exec().dblclick();
    await waitConnections(page, 1);
    await exec().click({ button: "right" });
    await page.getByRole("button", { name: "Bundle scope", exact: true }).click();
    await bundled().waitFor();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).project.graphs.demo.nodes.match.splitScopeOutputs.length === 0, key);
    assert.deepEqual((await saved(page)).graphs.demo.nodes.match.splitScopeOutputs, []);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(await page.locator("body").innerText(), errors, logs.slice(-12));
    throw error;
  }
}

export async function singleSchemaDrop(context) {
  await context.addInitScript(({ key, fixture }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, project: fixture }));
  }, { key, fixture });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.text().includes("STRICT_READ_UNTRACKED")) errors.push(message.text()); });
  await page.goto(process.env.PLAYGROUND_URL ?? "http://127.0.0.1:4315");
  await page.getByRole("button", { name: "Demo", exact: true }).first().click();
  const source = pin(page, "match", "output", JSON.stringify(["Port", scope]));
  await source.waitFor();
  await page.evaluate(() => {
    window.schemaMenuOpened = false;
    new MutationObserver(() => {
      if (document.querySelector('[role="dialog"][aria-label="Create node"]')) window.schemaMenuOpened = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const start = await source.boundingBox();
  const canvas = await page.locator('[data-active-graph-canvas]').boundingBox();
  assert(start && canvas);
  const drop = { x: canvas.x + 620, y: canvas.y + 430 };
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 15 });
  await page.keyboard.down("Shift");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await waitConnections(page, 2);
  const project = await saved(page);
  const nodes = Object.values(project.graphs.demo.nodes);
  assert.equal(nodes.length, 4);
  const inserted = nodes.find((node) => node.schema.package === "Scopes" && node.schema.schema === "BreakScope");
  assert(inserted, "Dropping a scope should insert the sole compatible Break Scope schema");
  assert(project.graphs.demo.connections.some((wire) => wire.outNodeId === "match" && wire.outIo._tag === "Port" && wire.outIo.id === scope && wire.inNodeId === inserted.id && wire.inIoId === "scope"));
  const input = await pin(page, inserted.id, "input", "scope").boundingBox();
  assert(input);
  assert.ok(Math.abs(input.x + input.width / 2 - drop.x) < 1);
  assert.ok(Math.abs(input.y + input.height / 2 - drop.y) < 1);
  assert.equal(await page.evaluate(() => window.schemaMenuOpened), false);
  assert.deepEqual(errors, []);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  try {
    for (const scenario of [inlineScopes, singleSchemaDrop]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        await scenario(context);
        console.log(`PASS: ${scenario.name}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
