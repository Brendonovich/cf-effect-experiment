import type { Clipboard } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { createEffect, createSignal, For } from "solid-js";

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
  row: { display: "grid", gap: 8, marginBlock: 16 },
  select: {
    backgroundColor: colors.gray3,
    border: `1px solid ${colors.gray6}`,
    padding: 8,
    color: colors.gray12,
  },
  actions: { display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24 },
});

export function ClipboardRebind(props: {
  requests: ReadonlyArray<Clipboard.RebindRequest>;
  finish: (bindings?: ReadonlyArray<Clipboard.Binding>) => void;
}) {
  let dialog: HTMLDialogElement | undefined;
  const [choices, setChoices] = createSignal<Record<string, string>>({});
  const key = (request: Clipboard.RebindRequest) =>
    JSON.stringify([request.nodeId, request.property]);
  createEffect(
    () => props.requests,
    () => {
      setChoices({});
      dialog?.showModal();
      return () => dialog?.close();
    },
  );
  return (
    <dialog
      ref={dialog}
      sx={styles.dialog}
      data-editor-shortcuts
      aria-label="Rebind clipboard references"
      onCancel={() => props.finish()}
    >
      <h2>Rebind clipboard references</h2>
      <p>
        Choose compatible destination definitions. Nothing is pasted until every reference is
        resolved. Missing connections are skipped.
      </p>
      <For each={props.requests}>
        {(request) => (
          <label sx={styles.row}>
            <span>
              {request.kind === "resource" ? "Resource constant" : "Node definition"}:{" "}
              {request.label}
            </span>
            <select
              sx={styles.select}
              value={choices()[key(request)] ?? ""}
              onChange={(event) =>
                setChoices((previous) => ({
                  ...previous,
                  [key(request)]: event.currentTarget.value,
                }))
              }
            >
              <option value="">
                {request.candidates.length === 0
                  ? "No compatible destination definitions"
                  : "Choose a definition"}
              </option>
              <For each={request.candidates}>
                {(candidate) => <option value={candidate.id}>{candidate.name}</option>}
              </For>
            </select>
          </label>
        )}
      </For>
      <div sx={styles.actions}>
        <Button type="button" onClick={() => props.finish()}>
          Cancel paste
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={props.requests.some((request) => !choices()[key(request)])}
          onClick={() =>
            props.finish(
              props.requests.map((request) => ({
                nodeId: request.nodeId,
                ...(request.property === undefined ? {} : { property: request.property }),
                target: choices()[key(request)]!,
              })),
            )
          }
        >
          Rebind and paste
        </Button>
      </div>
    </dialog>
  );
}
