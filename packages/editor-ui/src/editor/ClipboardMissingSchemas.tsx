import type { Clipboard } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { createEffect, For } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";

const styles = stylex.create({
  dialog: {
    backgroundColor: colors.gray2,
    color: colors.gray12,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 8,
    margin: "auto",
    padding: 24,
    width: 560,
    maxWidth: "calc(100vw - 24px)",
    maxHeight: "calc(100dvh - 24px)",
    overflow: "auto",
    "::backdrop": { backgroundColor: "rgb(0 0 0 / 0.65)" },
  },
  list: { marginBlock: 16 },
  actions: { display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24 },
});

export function ClipboardMissingSchemas(props: {
  schemas: ReadonlyArray<Clipboard.MissingSchema>;
  finish: (force: boolean) => void;
}) {
  let dialog: HTMLDialogElement | undefined;
  createEffect(
    () => props.schemas,
    () => {
      dialog?.showModal();
      return () => dialog?.close();
    },
  );
  return (
    <dialog
      ref={dialog}
      sx={styles.dialog}
      data-editor-shortcuts
      aria-label="Missing clipboard schemas"
      onCancel={() => props.finish(false)}
    >
      <h2>Missing node schemas</h2>
      <p>The following schemas are not available in this project:</p>
      <ul sx={styles.list}>
        <For each={props.schemas}>
          {(schema) => (
            <li>
              {schema.package}/{schema.schema}
            </li>
          )}
        </For>
      </ul>
      <p>
        You can paste these nodes anyway, but they cannot run or be fully validated until their
        schemas are available.
      </p>
      <div sx={styles.actions}>
        <Button type="button" onClick={() => props.finish(false)}>
          Cancel paste
        </Button>
        <Button type="button" variant="primary" onClick={() => props.finish(true)}>
          Paste anyway
        </Button>
      </div>
    </dialog>
  );
}
