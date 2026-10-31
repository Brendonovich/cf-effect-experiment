import { stylexProps } from "@macrograph/module/vite";
import { assert, it } from "vitest";

it("transforms intrinsic StyleX props while preserving component props", () => {
  const plugin = stylexProps();
  const source = `import type { StyleXStyles } from "@stylexjs/stylex";
import * as stylex from "@stylexjs/stylex";
const view = <><div sx={styles.root} /><svg sx={[styles.icon, active && styles.active]} /><Button sx={styles.button} /></>;`;
  const result = plugin.transform(source, "/src/view.tsx");

  assert.equal(
    result?.code,
    `import type { StyleXStyles } from "@stylexjs/stylex";
import * as stylex from "@stylexjs/stylex";
const view = <><div {...stylex.attrs(styles.root)} /><svg {...stylex.attrs([styles.icon, active && styles.active])} /><Button sx={styles.button} /></>;`,
  );
  assert.ok(result?.map);
});

it("adds a StyleX import when an intrinsic sx prop has no namespace import", () => {
  const plugin = stylexProps();
  const result = plugin.transform("const view = <div sx={styles.root} />;", "/src/view.tsx");

  assert.equal(
    result?.code,
    `import * as __macrographStylex from "@stylexjs/stylex";
const view = <div {...__macrographStylex.attrs(styles.root)} />;`,
  );
  assert.isUndefined(
    plugin.transform("const view = <Button sx={styles.root} />;", "/src/view.tsx"),
  );
});
