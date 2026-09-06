import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const key = "macrograph:local-project:local-browser";
const types = {
  person: {
    _tag: "Struct",
    id: "person",
    name: "Person",
    fields: [
      { name: "name", type: { _tag: "String" } },
      { name: "age", type: { _tag: "Int" } },
      { name: "nickname", type: { _tag: "Option", inner: { _tag: "String" } } },
    ],
  },
  address: {
    _tag: "Struct",
    id: "address",
    name: "Address",
    fields: [
      { name: "city", type: { _tag: "String" } },
      { name: "postcode", type: { _tag: "Int" } },
    ],
  },
  result: {
    _tag: "Enum",
    id: "result",
    name: "Result",
    variants: [
      { name: "Success", fields: [{ name: "person", type: { _tag: "Custom", id: "person" } }] },
      { name: "Failure", fields: [{ name: "message", type: { _tag: "String" } }] },
    ],
  },
};
const node = (id, schema, x, y, properties = {}, inputDefaults = {}, pkg = "CustomTypes") => ({
  id,
  name:
    {
      MakeStruct: "Make Struct",
      UpdateStruct: "Update Struct",
      StringifyJson: "Stringify JSON",
      MakeSome: "Make Some",
    }[schema] ?? schema,
  schema: { package: pkg, schema },
  properties,
  inputDefaults,
  foldPins: false,
  position: { x, y },
});
const wire = (outNodeId, outIoId, inNodeId, inIoId) => ({
  id: `${outNodeId}-${inNodeId}`,
  outNodeId,
  outIo: { _tag: "Port", id: outIoId },
  inNodeId,
  inIoId,
});
const project = (nodes = {}, connections = []) => ({
  name: "Custom type properties",
  types,
  constants: {},
  engines: {},
  graphs: { demo: { id: "demo", name: "Demo", nodes, connections } },
});
const button = (page, name) => page.getByRole("button", { name, exact: true });
const pin = (page, node, direction, id) =>
  page.locator(
    `[data-node-id=${JSON.stringify(node)}][data-io-direction=${JSON.stringify(direction)}][data-io-id=${JSON.stringify(direction === "output" ? JSON.stringify(["Port", id]) : id)}]`,
  );
const graphNode = (page, id) => page.locator(`[data-graph-node-id=${JSON.stringify(id)}]`);
const select = (page, id) => page.locator(`[data-node-header=${JSON.stringify(id)}]`).click();
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project, key);
const waitSaved = (page, predicate) =>
  page.waitForFunction(
    ({ key, source }) => {
      const value = localStorage.getItem(key);
      return (
        value && new Function("project", `return (${source})(project)`)(JSON.parse(value).project)
      );
    },
    { key, source: predicate.toString() },
  );

async function open(context, fixture) {
  await context.addInitScript(
    ({ key, fixture }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ version: 1, project: fixture }));
    },
    { key, fixture },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const logs = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    logs.push(message.text());
    if (message.text().includes("STRICT_READ_UNTRACKED")) errors.push(message.text());
  });
  await page.goto(process.env.PLAYGROUND_URL ?? "http://127.0.0.1:4315");
  await button(page, "Demo").first().click();
  await page.locator("[data-active-graph-canvas]").waitFor();
  return { page, errors, logs };
}

async function choose(page, group, name) {
  await page.getByRole("group", { name: group, exact: true }).getByRole("button").click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function create(page, name, x, y) {
  await page.locator("[data-active-graph-canvas]").click({ button: "right", position: { x, y } });
  const menu = page.getByRole("dialog", { name: "Create node", exact: true });
  await page.getByPlaceholder("Search nodes").fill(name);
  await button(menu, name).click();
  await menu.waitFor({ state: "detached" });
  await page.waitForFunction(
    ({ key, name }) =>
      Object.values(JSON.parse(localStorage.getItem(key)).project.graphs.demo.nodes).some(
        (node) => node.name === name,
      ),
    { key, name },
  );
  const found = Object.values((await saved(page)).graphs.demo.nodes).find(
    (node) => node.name === name,
  );
  await select(page, found.id);
  return found.id;
}

export async function selectors(context) {
  const { page, errors } = await open(context, project());
  try {
    await page
      .locator("[data-active-graph-canvas]")
      .click({ button: "right", position: { x: 80, y: 80 } });
    await page.getByPlaceholder("Search nodes").fill("Custom Types");
    const menu = page.getByRole("dialog", { name: "Create node", exact: true });
    for (const name of [
      "Make Struct",
      "Break Struct",
      "Update Struct",
      "Construct Enum",
      "Match Enum",
      "Parse JSON",
      "Stringify JSON",
    ])
      assert.equal(await button(menu, name).count(), 1);
    assert.equal(await button(menu, "Make Person").count(), 0);
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });

    const make = await create(page, "Make Struct", 80, 80);
    await page.getByRole("group", { name: "Target type", exact: true }).getByRole("button").click();
    assert.deepEqual(await page.getByRole("option").allTextContents(), ["Address", "Person"]);
    await page.getByRole("option", { name: "Person", exact: true }).click();
    await pin(page, make, "input", 'field:"age"').waitFor();
    assert.equal(await pin(page, make, "output", "value").getAttribute("title"), "Person");
    await choose(page, "Target type", "Address");
    await pin(page, make, "input", 'field:"city"').waitFor();
    assert.equal(await pin(page, make, "input", 'field:"age"').count(), 0);
    await choose(page, "Target type", "Person");
    await pin(page, make, "input", 'field:"name"').waitFor();

    const update = await create(page, "Update Struct", 400, 80);
    await choose(page, "Target type", "Person");
    await pin(page, update, "input", 'field:"nickname"').waitFor();
    assert.match(
      await pin(page, update, "input", 'field:"name"').getAttribute("title"),
      /Option.*String/,
    );
    assert.match(
      await pin(page, update, "input", 'field:"nickname"').getAttribute("title"),
      /Option.*Option.*String/,
    );
    assert.equal(await graphNode(page, update).locator('[data-io-direction="input"]').count(), 4);

    const construct = await create(page, "Construct Enum", 80, 330);
    await page.getByRole("group", { name: "Target type", exact: true }).getByRole("button").click();
    assert.deepEqual(await page.getByRole("option").allTextContents(), ["Result"]);
    await page.getByRole("option", { name: "Result", exact: true }).click();
    await choose(page, "Enum variant", "Success");
    await pin(page, construct, "input", 'field:"person"').waitFor();
    await choose(page, "Enum variant", "Failure");
    await pin(page, construct, "input", 'field:"message"').waitFor();
    assert.equal(await pin(page, construct, "input", 'field:"person"').count(), 0);

    const match = await create(page, "Match Enum", 400, 330);
    await choose(page, "Target type", "Result");
    await pin(page, match, "output", 'variant:"Success"').waitFor();
    await pin(page, match, "output", 'variant:"Failure"').waitFor();
    await waitSaved(page, (project) =>
      Object.values(project.graphs.demo.nodes).every((node) => node.properties.type),
    );
    const before = await saved(page);
    await page.reload();
    await page.locator(`[data-node-header=${JSON.stringify(match)}]`).waitFor();
    await select(page, construct);
    await button(
      page.getByRole("group", { name: "Enum variant", exact: true }),
      "Failure",
    ).waitFor();
    assert.deepEqual((await saved(page)).graphs, before.graphs);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(await page.locator("body").innerText(), errors);
    throw error;
  }
}

export async function optionalUpdates(context) {
  const fixture = project(
    {
      make: node(
        "make",
        "MakeStruct",
        40,
        40,
        { type: "person" },
        {
          'field:"name"': "Ada",
          'field:"age"': 37,
          'field:"nickname"': { _tag: "Some", value: "Ada" },
        },
      ),
      some: node("some", "MakeSome", 40, 280, { type: "String" }, { in: "Grace" }, "logic"),
      update: node("update", "UpdateStruct", 350, 40, { type: "person" }),
      stringify: node("stringify", "StringifyJson", 650, 40, { type: "person" }),
      tick: node("tick", "Tick", 350, 300, {}, {}, "util"),
      print: node("print", "Print", 650, 300, {}, {}, "util"),
    },
    [
      wire("make", "value", "update", "value"),
      wire("update", "value", "stringify", "value"),
      wire("stringify", "json", "print", "in"),
      wire("tick", "exec", "print", "exec"),
    ],
  );
  const { page, errors, logs } = await open(context, fixture);
  const waitPrint = (name, start = 0) =>
    new Promise((resolve, reject) => {
      const matches = (text) =>
        text.includes(`"name":"${name}"`) &&
        text.includes('"age":37') &&
        text.includes('"nickname":{"_tag":"Some","value":"Ada"}');
      if (logs.slice(start).some(matches)) return resolve();
      const listener = (message) => {
        if (matches(message.text())) {
          clearTimeout(timeout);
          page.off("console", listener);
          resolve();
        }
      };
      const timeout = setTimeout(() => {
        page.off("console", listener);
        reject(new Error(`Missing Print for ${name}: ${logs.slice(-10)}`));
      }, 15000);
      page.on("console", listener);
    });
  try {
    await waitPrint("Ada");
    await select(page, "update");
    await page
      .getByText("None keeps a field unchanged. Some replaces its value.", { exact: true })
      .waitFor();
    assert.match(
      await pin(page, "update", "input", 'field:"nickname"').getAttribute("title"),
      /Option.*Option.*String/,
    );
    const source = await pin(page, "some", "output", "out").boundingBox();
    const target = await pin(page, "update", "input", 'field:"name"').boundingBox();
    assert(source && target);
    const start = logs.length;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
    await page.mouse.up();
    await waitSaved(page, (project) => project.graphs.demo.connections.length === 5);
    await waitPrint("Grace", start);
    assert.deepEqual((await saved(page)).graphs.demo.nodes.update.inputDefaults, {});
    await graphNode(page, "some").getByRole("textbox").fill("Katherine");
    await graphNode(page, "some").getByRole("textbox").press("Tab");
    await waitPrint("Katherine", start);
    await page.reload();
    await pin(page, "update", "input", 'field:"name"').waitFor();
    await waitPrint("Katherine", logs.length);
    const disconnected = logs.length;
    await pin(page, "update", "input", 'field:"name"').dblclick();
    await waitSaved(page, (project) => project.graphs.demo.connections.length === 4);
    await waitPrint("Ada", disconnected);
    await select(page, "update");
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(await page.locator("body").innerText(), errors, logs.slice(-15));
    throw error;
  }
}

export async function breakStructOutputs(context) {
  const { page, errors } = await open(context, project({
    person: node("person", "MakeStruct", 60, 80, { type: "person" }),
    address: node("address", "MakeStruct", 60, 440, { type: "address" }),
    break: node("break", "BreakStruct", 430, 80),
    print: node("print", "Print", 780, 80, {}, {}, "util"),
  }));
  const outputs = () => page.locator('[data-node-id="break"][data-io-direction="output"]');
  const connect = async (from, output, to, input) => {
    const source = await pin(page, from, "output", output).boundingBox();
    const target = await pin(page, to, "input", input).boundingBox();
    assert.ok(source && target, "both connection endpoints must be visible");
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
    await page.mouse.up();
  };
  try {
    await select(page, "break");
    assert.equal(await page.getByRole("group", { name: "Target type", exact: true }).count(), 0);
    assert.equal(await outputs().count(), 0);
    let navigations = 0;
    page.on("framenavigated", () => navigations++);

    await connect("person", "value", "break", "value");
    await waitSaved(page, (project) => project.graphs.demo.connections.length === 1);
    for (const field of ["name", "age", "nickname"])
      await pin(page, "break", "output", `field:${JSON.stringify(field)}`).waitFor();
    assert.equal(await outputs().count(), 3, "connecting Person must immediately generate its fields");
    assert.equal(await pin(page, "break", "output", 'field:"age"').getAttribute("title"), "Int");
    assert.deepEqual((await saved(page)).graphs.demo.nodes.break.properties, {});

    // The new pins must be usable immediately, not just labels in a refreshed snapshot.
    await connect("break", 'field:"name"', "print", "in");
    await waitSaved(page, (project) => project.graphs.demo.connections.length === 2);
    // Invoke the disconnect gesture without also starting a new pin drag on pointerdown.
    await pin(page, "print", "input", "in").dispatchEvent("dblclick");
    await waitSaved(page, (project) => project.graphs.demo.connections.length === 1);
    await pin(page, "break", "input", "value").dispatchEvent("dblclick");
    await waitSaved(page, (project) => project.graphs.demo.connections.length === 0);
    await pin(page, "break", "output", 'field:"name"').waitFor({ state: "detached" });
    assert.equal(await outputs().count(), 0);

    await connect("address", "value", "break", "value");
    await waitSaved(page, (project) => project.graphs.demo.connections.length === 1);
    for (const field of ["city", "postcode"])
      await pin(page, "break", "output", `field:${JSON.stringify(field)}`).waitFor();
    assert.equal(await outputs().count(), 2, "reconnecting Address must replace the field set");
    assert.equal(navigations, 0, "field generation must not require a reload");
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(await page.locator("body").innerText(), errors);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"
  );
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  try {
    const scenarios = [selectors, optionalUpdates, breakStructOutputs].filter(
      (scenario) => !process.env.BROWSER_SCENARIO || scenario.name === process.env.BROWSER_SCENARIO,
    );
    assert.ok(scenarios.length > 0, `Unknown browser scenario: ${process.env.BROWSER_SCENARIO}`);
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        await scenario(context);
        console.log(`PASS: ${scenario.name}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
