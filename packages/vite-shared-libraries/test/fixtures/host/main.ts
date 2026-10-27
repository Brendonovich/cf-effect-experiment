import * as stylex from "@stylexjs/stylex";
import { Effect, Schema } from "effect";
import * as SchemaModule from "effect/Schema";
import { createRoot, createSignal } from "solid-js";

import "./main.css";

const styles = stylex.create({
  shorthand: { padding: 1 },
  block: { paddingBlock: 2 },
});

Object.assign(globalThis, {
  macrographHost: {
    createRoot,
    createSignal,
    Effect,
    Schema,
    SchemaString: SchemaModule.String,
    props: stylex.props,
    paddingClassName: stylex.props(styles.shorthand, styles.block).className,
  },
});
