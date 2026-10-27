import { ModuleId } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import { For, Show, createEffect, createSignal } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";
import { Badge, Notice } from "./primitives.tsx";

export interface UntrustedConfirmation {
  readonly kind: "install" | "update";
  readonly id: ModuleId.Id;
  readonly version: string;
  readonly registry: string;
  readonly requires: ReadonlyArray<string>;
  readonly node: ReadonlyArray<string>;
}

export interface UntrustedInstallDialogProps {
  readonly confirmation: UntrustedConfirmation;
  /** The registry's display name, when known. */
  readonly registryName?: string | undefined;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

function DeclarationList(props: { readonly label: string; readonly items: ReadonlyArray<string> }) {
  return (
    <div sx={styles.declaration}>
      <dt sx={styles.term}>{props.label}</dt>
      <dd sx={styles.value}>
        <Show when={props.items.length > 0} fallback={<span sx={styles.none}>None declared</span>}>
          <ul sx={styles.list}>
            <For each={props.items}>{(item) => <li sx={styles.code}>{item}</li>}</For>
          </ul>
        </Show>
      </dd>
    </div>
  );
}

/** Confirmation for installing or updating to an untrusted release (spec section 14). */
export function UntrustedInstallDialog(props: UntrustedInstallDialogProps) {
  let dialog: HTMLDialogElement | undefined;
  const [acknowledged, setAcknowledged] = createSignal(false);

  createEffect(
    () => props.confirmation,
    () => {
      setAcknowledged(false);
      if (dialog && !dialog.open) dialog.showModal();
      return () => dialog?.close();
    },
  );

  const action = () => (props.confirmation.kind === "install" ? "Install" : "Update");
  const unverified = () =>
    `The author of this release isn't verified by ${props.registryName ?? props.confirmation.registry}. Only continue if you trust the publisher.`;

  return (
    <dialog
      ref={dialog}
      sx={styles.dialog}
      aria-labelledby="untrusted-install-title"
      data-untrusted-install-dialog
      onCancel={(event) => {
        event.preventDefault();
        if (!props.pending) props.onCancel();
      }}
    >
      <h2 id="untrusted-install-title" sx={styles.title}>
        {action()} an untrusted module?
      </h2>
      <p sx={styles.subtitle}>
        {ModuleId.toDisplay(props.confirmation.id)} {props.confirmation.version}
      </p>

      <dl sx={styles.details}>
        <div sx={styles.declaration}>
          <dt sx={styles.term}>Publisher</dt>
          <dd sx={styles.value}>{ModuleId.publisher(props.confirmation.id)}</dd>
        </div>
        <div sx={styles.declaration}>
          <dt sx={styles.term}>Registry</dt>
          <dd sx={styles.value}>
            {props.registryName ?? props.confirmation.registry}
            <Show when={props.registryName}>
              <span sx={styles.none}> ({props.confirmation.registry})</span>
            </Show>
          </dd>
        </div>
        <div sx={styles.declaration}>
          <dt sx={styles.term}>Trust</dt>
          <dd sx={styles.value}>
            <Badge tone="warning">Untrusted</Badge>
          </dd>
        </div>
        <DeclarationList label="Requires host services" items={props.confirmation.requires} />
        <DeclarationList label="Node built-ins" items={props.confirmation.node} />
      </dl>

      <Notice tone="warning">{unverified()}</Notice>
      <p sx={styles.sandbox}>
        These declarations describe what the module says it uses. They are not a sandbox: the
        module's server code runs inside this server with full access, and its UI runs in the editor
        as the signed-in user.
      </p>

      <label sx={styles.checkbox}>
        <input
          type="checkbox"
          checked={acknowledged()}
          disabled={props.pending}
          onChange={(event) => setAcknowledged(event.currentTarget.checked)}
          data-untrusted-acknowledge
        />
        <span>I understand the risk and trust this publisher.</span>
      </label>

      <Show when={props.error}>
        {(error) => (
          <p sx={styles.error} role="alert">
            {error()}
          </p>
        )}
      </Show>

      <div sx={styles.actions}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={props.pending}
          onClick={() => props.onCancel()}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!acknowledged() || props.pending}
          onClick={() => props.onConfirm()}
          data-untrusted-confirm
        >
          {props.pending ? `${action() === "Install" ? "Installing" : "Updating"}...` : action()}
        </Button>
      </div>
    </dialog>
  );
}

const styles = stylex.create({
  dialog: {
    boxSizing: "border-box",
    width: 480,
    maxWidth: "calc(100vw - 24px)",
    maxHeight: "calc(100dvh - 24px)",
    margin: "auto",
    overflow: "auto",
    padding: 20,
    borderColor: colors.gray6,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray2,
    color: colors.gray12,
    fontSize: 12,
    "::backdrop": { backgroundColor: "rgb(0 0 0 / 0.65)" },
  },
  title: { margin: 0, fontSize: 15, fontWeight: 600 },
  subtitle: { marginBottom: 0, marginTop: 4, color: colors.gray11, fontFamily: "monospace" },
  details: { display: "grid", gap: 8, marginBlock: 16 },
  declaration: { display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, margin: 0 },
  term: { color: colors.gray10 },
  value: { margin: 0, overflowWrap: "anywhere" },
  list: { display: "flex", flexWrap: "wrap", gap: 4, margin: 0, padding: 0, listStyle: "none" },
  code: {
    borderRadius: 2,
    backgroundColor: colors.gray4,
    paddingInline: 4,
    fontFamily: "monospace",
    fontSize: 11,
  },
  none: { color: colors.gray10 },
  sandbox: { marginBottom: 0, marginTop: 10, color: colors.gray11, lineHeight: "18px" },
  checkbox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    cursor: "pointer",
    color: colors.gray12,
  },
  error: { marginBottom: 0, marginTop: 12, color: colors.red10 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 },
});
