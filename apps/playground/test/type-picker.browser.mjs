import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      ...(width === 390 ? { isMobile: true, hasTouch: true } : {}),
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.MACROGRAPH_TEST_URL ?? "http://127.0.0.1:4185");
    if (width === 390) await page.getByRole("button", { name: "Browse", exact: true }).click();
    await page.getByRole("button", { name: "Events", exact: true }).click();
    await page.getByRole("button", { name: "New event", exact: true }).click();
    await page.getByLabel("Event name", { exact: true }).fill("Nested Event");
    await page.getByRole("button", { name: "Add field", exact: true }).click();
    await page.getByLabel("Field name", { exact: true }).fill("Values");
    const picker = page.locator('[data-component="data-type-picker"]');
    const search = page.getByRole("combobox", { name: "Search data types" });
    const choose = async (depth, type) => {
      await picker.locator(`[data-type-depth="${depth}"]`).click();
      assert.equal(await search.evaluate((element) => document.activeElement === element), true);
      await search.fill(type.toLowerCase());
      await page.getByRole("option", { name: type, exact: true }).click();
      await search.waitFor({ state: "hidden" });
      assert.equal(
        await picker
          .locator(`[data-type-depth="${depth}"]`)
          .evaluate((element) => document.activeElement === element),
        true,
      );
    };
    await choose(0, "List");
    await choose(1, "Option");
    await choose(2, "List");
    await choose(3, "Int");
    await picker.locator('[data-type-depth="3"]').press("ArrowDown");
    await search.fill("nonexistent");
    await page.getByText("No data types found", { exact: true }).waitFor();
    await search.press("ControlOrMeta+a");
    await search.press("Backspace");
    assert.equal(await search.inputValue(), "");
    await search.press("Escape");
    assert.equal(
      await picker
        .locator('[data-type-depth="3"]')
        .evaluate((element) => document.activeElement === element),
      true,
    );
    await picker.locator('[data-type-depth="3"]').press("Enter");
    await search.fill("bool");
    await search.press("Enter");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await page.getByRole("button", { name: "Edit Nested Event", exact: true }).waitFor();
    const expected = {
      _tag: "List",
      item: { _tag: "Option", inner: { _tag: "List", item: { _tag: "Bool" } } },
    };
    await page.waitForFunction((expected) => {
      const raw = localStorage.getItem("macrograph:local-project:local-browser");
      return (
        raw &&
        JSON.stringify(Object.values(JSON.parse(raw).project.customEvents)[0]?.fields[0]?.type) ===
          JSON.stringify(expected)
      );
    }, expected);
    await page.reload();
    if (width === 390) await page.getByRole("button", { name: "Browse", exact: true }).click();
    await page.getByRole("button", { name: "Events", exact: true }).click();
    await page.getByRole("button", { name: "Edit Nested Event", exact: true }).click();
    await picker.waitFor();
    assert.equal(await picker.locator("[data-type-depth]").count(), 4);
    await choose(1, "List");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await page.getByText("Values: List<List<List<Bool>>>", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS ${width}px: searchable arbitrary nesting, keyboard, Escape/focus, native select-all/delete, edit and persisted reload`,
    );
  }
} finally {
  await browser.close();
}
