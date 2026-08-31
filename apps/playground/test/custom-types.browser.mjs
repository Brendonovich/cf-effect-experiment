import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// Run against the playground dev server. PLAYWRIGHT_MODULE can point to an existing installation.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"
);
const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const logs = [];
const waitLog = (predicate, start = 0) =>
  new Promise((resolve, reject) => {
    const found = logs.slice(start).find(predicate);
    if (found) {
      resolve(found);
      return;
    }
    const listener = (message) => {
      if (predicate(message.text())) {
        clearTimeout(timeout);
        page.off("console", listener);
        resolve(message.text());
      }
    };
    const timeout = setTimeout(() => {
      page.off("console", listener);
      reject(new Error("Expected runtime log was not emitted"));
    }, 15000);
    page.on("console", listener);
  });
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", async (message) => {
  logs.push(message.text());
  if (message.text().includes("Utilities Print")) {
    for (const arg of message.args()) {
      const value = await arg.jsonValue().catch(() => undefined);
      if (value !== undefined) logs.push(JSON.stringify(value));
    }
  }
  if (message.text().includes("STRICT_READ_UNTRACKED")) errors.push(message.text());
});
const key = "macrograph:local-project:local-browser";
const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
const snapshot = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).project, key);
const waitSaved = async (predicate) => {
  await page.waitForFunction(
    ({ key, source }) => {
      const value = localStorage.getItem(key);
      return (
        value && new Function("project", `return (${source})(project)`)(JSON.parse(value).project)
      );
    },
    { key, source: predicate.toString() },
  );
};
const choose = async (scope, depth, name) => {
  await scope.locator(`[data-type-depth="${depth}"]`).click();
  await page.getByRole("combobox", { name: "Search data types", exact: true }).fill(name);
  await page.getByRole("option").filter({ hasText: name }).first().click();
};
const preview = async () => {
  await button("Preview changes").click();
  await page.getByRole("dialog", { name: "Confirm type changes", exact: true }).waitFor();
};
const confirm = async () => {
  await button("Confirm changes").click();
  await page
    .getByRole("dialog", { name: "Confirm type changes", exact: true })
    .waitFor({ state: "detached" });
};
const createNode = async (name, x, y) => {
  await page.locator("[data-active-graph-canvas]").click({ button: "right", position: { x, y } });
  await page.getByPlaceholder("Search nodes").fill(name);
  await button(name, page.getByRole("dialog", { name: "Create node", exact: true })).click();
  await page
    .getByRole("dialog", { name: "Create node", exact: true })
    .waitFor({ state: "detached" });
  await waitSaved((project) =>
    Object.values(project.graphs).some((graph) => Object.values(graph.nodes).length > 0),
  );
  await page.waitForFunction(
    ({ key, name }) =>
      Object.values(JSON.parse(localStorage.getItem(key)).project.graphs).some((graph) =>
        Object.values(graph.nodes).some((node) => node.name === name),
      ),
    { key, name },
  );
  const project = await snapshot();
  return Object.values(project.graphs)
    .flatMap((graph) => Object.values(graph.nodes))
    .find((node) => node.name === name);
};
const selectNode = async (node) => page.locator(`[data-node-header="${node.id}"]`).click();
const wire = async (source, target) => {
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  assert(a && b);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
};

const executionFixture = (types) => {
  const person = Object.values(types).find((type) => type.name === "Person");
  const response = Object.values(types).find((type) => type.name === "Response");
  const custom = { _tag: "Custom", id: person.id };
  const field = (name) => `field:${JSON.stringify(name)}`;
  const nodes = {};
  const connections = [];
  const add = (id, pkg, schema, defaults = {}, properties = {}) => {
    nodes[id] = {
      id,
      name: id,
      schema: { package: pkg, schema },
      properties,
      inputDefaults: defaults,
      foldPins: false,
      position: {
        x: (Object.keys(nodes).length % 4) * 240,
        y: Math.floor(Object.keys(nodes).length / 4) * 120,
      },
    };
    return id;
  };
  const generated = (id, type, operation, defaults = {}, member) =>
    add(
      id,
      "CustomTypes",
      JSON.stringify(member === undefined ? [type.id, operation] : [type.id, operation, member]),
      defaults,
    );
  const connect = (outNodeId, outIoId, inNodeId, inIoId) =>
    connections.push({ id: `wire-${connections.length}`, outNodeId, outIoId, inNodeId, inIoId });
  const date = [{ _tag: "Some", value: "2026-08-31T00:00:00.000Z" }];
  const original = { _type: person.id, name: "original", dates: date };
  const updated = { ...original, name: "PR15_EXECUTION_PROOF" };
  add("tick", "util", "Tick");
  generated("make", person, "make", { [field("name")]: "original", [field("dates")]: date });
  generated("update", person, "update", { [field("name")]: updated.name }, "name");
  generated("stringify", person, "stringify");
  generated("parse", person, "parse");
  generated("break", person, "break");
  generated("construct", response, "construct", {}, "Ok");
  generated("match", response, "match");
  generated("roundtrip", person, "stringify");
  connect("make", "value", "update", "value");
  connect("update", "value", "stringify", "value");
  connect("stringify", "json", "parse", "json");
  connect("parse", "value", "break", "value");
  connect("parse", "value", "construct", field("person"));
  connect("construct", "value", "match", "value");
  connect("match", `variant:${JSON.stringify("Ok")}/${field("person")}`, "roundtrip", "value");
  add("format", "util", "FormatString", {}, { format: "PR15_RUNTIME {name} {json}" });
  connect("break", field("name"), "format", "name");
  connect("roundtrip", "json", "format", "json");
  add("print", "util", "Print");
  connect("format", "result", "print", "in");
  connect("tick", "exec", "match", "exec");
  let previous = "match";
  let previousPort = `variant:${JSON.stringify("Ok")}`;
  const listOperation = (id, schema, defaults, execution = false) => {
    add(id, "list", schema, defaults, { type: JSON.stringify(custom) });
    if (execution) {
      connect(previous, previousPort, id, "exec");
      previous = id;
      previousPort = "exec";
    }
  };
  listOperation("create", "ListCreate", { "value-0": original });
  listOperation("push", "PushListValue", { value: updated }, true);
  connect("create", "out", "push", "list");
  listOperation("insert", "InsertListValue", { value: original, index: 1 }, true);
  connect("push", "outList", "insert", "list");
  listOperation("set", "SetListValue", { value: updated, index: 0 }, true);
  connect("insert", "outList", "set", "list");
  listOperation("remove", "RemoveListValue", { index: 1 }, true);
  connect("set", "outList", "remove", "list");
  listOperation("random", "GetRandomListItem", {}, true);
  connect("remove", "returnList", "random", "list");
  listOperation("slice", "SliceList", { start: 0, end: 1 });
  connect("remove", "returnList", "slice", "list");
  listOperation("includes", "ListIncludes", { input: updated });
  connect("slice", "output", "includes", "list");
  add("branch", "util", "Branch");
  connect(previous, previousPort, "branch", "exec");
  connect("includes", "output", "branch", "condition");
  connect("branch", "trueOut", "print", "exec");
  listOperation("get", "GetListValue", { index: 0 });
  connect("slice", "output", "get", "list");
  listOperation("length", "ListLength", {});
  connect("slice", "output", "length", "list");
  const reportId = "collection-report";
  const report = {
    _tag: "Struct",
    id: reportId,
    name: "CollectionReport",
    fields: [
      { name: "get", type: { _tag: "Option", inner: custom } },
      { name: "random", type: { _tag: "Option", inner: custom } },
      { name: "removed", type: { _tag: "Option", inner: custom } },
      { name: "length", type: { _tag: "Int" } },
    ],
  };
  generated("report", report, "make");
  generated("reportJSON", report, "stringify");
  connect("get", "return", "report", field("get"));
  connect("random", "return", "report", field("random"));
  connect("remove", "returnValue", "report", field("removed"));
  connect("length", "output", "report", field("length"));
  connect("report", "value", "reportJSON", "value");
  add("printReport", "util", "Print");
  connect("print", "exec", "printReport", "exec");
  connect("reportJSON", "json", "printReport", "in");
  return {
    name: "PR15 execution regression",
    graphs: { acceptance: { id: "acceptance", name: "Acceptance", nodes, connections } },
    constants: {},
    engines: {},
    types: { ...types, [reportId]: report },
  };
};

const importProject = async (project) => {
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "custom-types.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, project })),
  });
  await button("Types").waitFor();
  await waitSaved((project) => project.name === "PR15 execution regression");
};

try {
  await page.goto(process.env.PLAYGROUND_URL ?? "http://127.0.0.1:4315");
  await button("Types").click();
  await button("New struct").click();
  await page.getByLabel("Type name", { exact: true }).fill("Person");
  await button("Add field").click();
  await page.getByLabel("Field 1 name", { exact: true }).fill("name");
  await button("Add field").click();
  await page.getByLabel("Field 2 name", { exact: true }).fill("dates");
  const dates = page.locator('[data-type-field="1"]');
  await choose(dates, 0, "List");
  await choose(dates, 1, "Option");
  await choose(dates, 2, "DateTime");
  await preview();
  await button("Cancel changes").click();
  assert.equal(await button("Edit type Person").count(), 0, "preview cancel is read-only");
  await preview();
  await confirm();
  await waitSaved((project) => Object.values(project.types).some((type) => type.name === "Person"));
  const person = Object.values((await snapshot()).types).find((type) => type.name === "Person");

  await button("New enum").click();
  await page.getByLabel("Type name", { exact: true }).fill("Response");
  await page.getByLabel("Variant 1 name", { exact: true }).fill("Ok");
  await button("Add field").click();
  await page.getByLabel("Field 1 name", { exact: true }).fill("person");
  await choose(page.locator('[data-type-field="0"]'), 0, "Person");
  await button("Add variant").click();
  await page.getByLabel("Variant 2 name", { exact: true }).fill("Empty");
  await preview();
  await confirm();
  await waitSaved((project) =>
    Object.values(project.types).some((type) => type.name === "Response"),
  );
  const authoredTypes = (await snapshot()).types;
  await button("Graphs").click();
  await button("New graph").click();
  await page.locator("[data-active-graph-canvas]").waitFor();
  const listPickerNode = await createNode("List Create", 60, 340);
  await selectNode(listPickerNode);
  await choose(page.getByRole("group", { name: "List item type", exact: true }), 0, "Person");
  await page.waitForFunction(
    ({ key, id }) =>
      Object.values(JSON.parse(localStorage.getItem(key)).project.graphs).some((graph) =>
        graph.nodes[id]?.properties.type?.includes("Custom"),
      ),
    { key, id: listPickerNode.id },
  );
  await selectNode(listPickerNode);
  await page.keyboard.press("Delete");
  await page.waitForFunction(
    ({ key, id }) =>
      Object.values(JSON.parse(localStorage.getItem(key)).project.graphs).every(
        (graph) => !graph.nodes[id],
      ),
    { key, id: listPickerNode.id },
  );
  const make = await createNode("Make Person", 60, 80);
  const stringify = await createNode("Stringify Person JSON", 460, 100);
  const match = await createNode("Match Response", 460, 340);
  await selectNode(match);
  const matchDefault = page.locator('[data-default-editor="Response"]');
  await button("Set default", matchDefault).click();
  await matchDefault.getByLabel("Response variant", { exact: true }).selectOption("Ok");
  await matchDefault.getByLabel("Response.person.name", { exact: true }).fill("Ada");
  await button("Save default", matchDefault).click();
  await matchDefault.getByLabel("Saved Response").waitFor();
  await selectNode(make);
  const datesDefault = page.locator('[data-default-editor="dates"]');
  await button("Set default", datesDefault).click();
  await button("Add item", datesDefault).click();
  await datesDefault.getByLabel("dates item 1 option", { exact: true }).selectOption("Some");
  await datesDefault
    .getByLabel("dates item 1 value", { exact: true })
    .fill("2026-08-31T00:00:00.000Z");
  await button("Save default", datesDefault).click();
  const nameDefault = page.locator('[data-default-editor="name"]');
  await button("Set default", nameDefault).click();
  await nameDefault.getByLabel("name", { exact: true }).fill("Ada");
  await button("Save default", nameDefault).click();
  const makeOutput = page
    .locator(`[data-node-id="${make.id}"][data-io-direction="output"]`)
    .first();
  const stringifyInput = page
    .locator(`[data-node-id="${stringify.id}"][data-io-direction="input"]`)
    .first();
  await wire(makeOutput, stringifyInput);
  await waitSaved((project) =>
    Object.values(project.graphs).some((graph) => graph.connections.length === 1),
  );

  await button("Types").click();
  await button("Edit type Person").click();
  await page.getByLabel("Type name", { exact: true }).fill("Profile");
  await preview();
  await button("Make Person").click();
  await page.locator("input").filter({ visible: true }).last().fill("Renamed Make");
  await page.locator("input").filter({ visible: true }).last().press("Enter");
  await waitSaved((project) =>
    Object.values(project.graphs).some((graph) =>
      Object.values(graph.nodes).some((node) => node.name === "Renamed Make"),
    ),
  );
  await confirm();
  await page.getByRole("alert").filter({ hasText: "Stale" }).waitFor();
  assert.equal(
    (await snapshot()).types[person.id].name,
    "Person",
    "stale preview does not mutate registry",
  );
  await preview();
  await confirm();
  await waitSaved((project) =>
    Object.values(project.types).some((type) => type.name === "Profile"),
  );
  assert.equal(
    (await snapshot()).types[person.id].name,
    "Profile",
    "rename retains nominal identity",
  );
  await button("Edit type Profile").click();
  await button("Remove field 1").click();
  await preview();
  assert.match(
    await page.getByRole("dialog", { name: "Confirm type changes" }).innerText(),
    /Response/,
  );
  await button("Cancel changes").click();
  assert.equal((await snapshot()).types[person.id].fields.length, 2);
  await preview();
  await confirm();
  await selectNode(make);
  await page.getByText(/Orphan input:/).waitFor();
  assert.equal((await page.locator("[data-invalid-pin]").count()) > 0, true);
  const nodeBounds = await page.locator(`[data-graph-node="${make.id}"]`).boundingBox();
  const retainedOutput = await page
    .locator(`[data-node-id="${make.id}"][data-io-direction="output"]`)
    .first()
    .boundingBox();
  assert(
    nodeBounds &&
      retainedOutput &&
      retainedOutput.x >= nodeBounds.x &&
      retainedOutput.x + retainedOutput.width <= nodeBounds.x + nodeBounds.width,
    "orphan labels must not push current output pins outside the node",
  );
  await button(
    "Remove default",
    page.locator("[data-default-editor]").filter({ hasText: "Ada" }).first(),
  ).click();
  await selectNode(match);
  const responseDefault = page.locator('[data-default-editor="Response"]');
  await button("Edit default", responseDefault).click();
  await button("Remove obsolete field name", responseDefault).click();
  await button("Save default", responseDefault).click();
  await button("Delete type Profile").click();
  await button("Cancel changes").click();
  assert((await snapshot()).types[person.id]);
  await button("Delete type Profile").click();
  await confirm();
  await page.locator("[data-invalid-wire]").waitFor();
  await selectNode(make);
  await page
    .getByText("Missing node schema. Restore its type or remove this node.", { exact: true })
    .waitFor();
  await button("Remove invalid wire").click();
  await waitSaved((project) =>
    Object.values(project.graphs).every((graph) => graph.connections.length === 0),
  );
  await page.reload();
  await button("Types").waitFor();
  assert.equal((await snapshot()).types[person.id], undefined);
  assert.equal(
    Object.values((await snapshot()).graphs).flatMap((graph) => Object.values(graph.nodes)).length,
    3,
    "invalid nodes survive reload",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await button("Browse").click();
  await button("Types").click();
  await button("Edit type Response").click();
  await choose(page.locator('[data-type-field="0"]'), 0, "String");
  await preview();
  await confirm();
  await waitSaved((project) =>
    Object.values(project.types).some(
      (type) => type.name === "Response" && type.variants[0].fields[0].type._tag === "String",
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = executionFixture(authoredTypes);
  await importProject(fixture);
  await waitLog((log) => log.includes("collection-report"));
  assert(
    logs.some(
      (log) => log.includes("PR15_RUNTIME PR15_EXECUTION_PROOF") && log.includes("2026-08-31"),
    ),
    "make/update/JSON parse/break/construct/match executes and retains nested dates",
  );
  assert(
    logs.some((log) => log.includes("collection-report") && /length.{0,8}1/.test(log)),
    "all custom list operations execute and serialize their Option outputs",
  );
  await button("events").click();
  await page.getByRole("button").filter({ hasText: "TickEvent" }).first().click();
  page.once("dialog", (dialog) => dialog.accept());
  await button("Replay").click();
  await page.getByText(/Replay queued/).waitFor();
  await button("editor").click();
  await button("Types").click();
  await button("Edit type Person").click();
  await choose(page.locator('[data-type-field="0"]'), 0, "Int");
  await preview();
  await confirm();
  const beforeBlocked = logs.filter((log) => log.includes("Utilities Print")).length;
  const blockedLogStart = logs.length;
  await button("events").click();
  await page.getByRole("button").filter({ hasText: "TickEvent" }).first().click();
  page.once("dialog", (dialog) => dialog.accept());
  await button("Replay").click();
  await page.getByText(/Replay queued/).waitFor();
  await waitLog((log) => log.includes("InvalidInputValue"), blockedLogStart);
  await page.getByRole("button").filter({ hasText: "TickEvent" }).first().click();
  await page
    .getByText(/InvalidTypeGraph|Invalid.*default|does not match/)
    .first()
    .waitFor();
  assert.equal(
    logs.filter((log) => log.includes("Utilities Print")).length,
    beforeBlocked,
    "invalid reachable defaults block side effects",
  );
  await button("editor").click();
  const restoredLogStart = logs.length;
  await button("Edit type Person").click();
  await choose(page.locator('[data-type-field="0"]'), 0, "String");
  await preview();
  await confirm();
  await waitLog((log) => log.includes("collection-report"), restoredLogStart);
  assert(
    logs.filter((log) => log.includes("Utilities Print")).length > beforeBlocked,
    "restoring type repairs preserved defaults and resumes execution",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: struct/enum/nested picker/defaults/List selector/all generated and collection execution/JSON roundtrip/replay/runtime block-restore/wire/rename/stale-preview/cancel-confirm/orphan-repair/delete/reload/mobile",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  console.error(errors);
  console.error(logs.slice(-15));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
