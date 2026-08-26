import type { Package } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { Show, createSignal } from "solid-js";

import { colors } from "../../tokens.stylex.ts";

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: 2 },
  label: {
    alignItems: "center",
    color: colors.gray11,
    display: "flex",
    fontSize: 11,
    fontWeight: 500,
    justifyContent: "space-between",
  },
  clear: {
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 400,
    paddingInline: 4,
    backgroundColor: {
      default: "transparent",
      ":hover": "color-mix(in srgb, var(--gray-12) 10%, transparent)",
    },
  },
  description: { color: colors.gray10, fontSize: 10, lineHeight: "12px" },
  input: {
    backgroundColor: colors.gray2,
    borderRadius: 2,
    boxShadow: {
      default: `0 0 0 1px ${colors.gray6}`,
      ":focus-visible": `inset 0 0 0 1px ${colors.focus}`,
    },
    fontSize: 12,
    height: 24,
    outline: "none",
    paddingInline: 4,
    width: "100%",
  },
  checkbox: { accentColor: colors.focus, height: 16, width: 16 },
});

export function PropertyControl(props: {
  property: Extract<Package.PropertyDefinition, { readonly type: unknown }>;
  value: unknown;
  onSet: (value: unknown) => void;
  onClear: () => void;
}) {
  const formatValue = () => {
    const value = props.value;
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  };
  const [draft, setDraft] = createSignal(formatValue);
  const commitNumber = () => {
    const value = Number(draft());
    const valid =
      draft().trim() !== "" &&
      Number.isFinite(value) &&
      (props.property.type._tag !== "Int" || Number.isSafeInteger(value));
    if (valid) props.onSet(value);
    else setDraft(formatValue());
  };

  return (
    <label sx={styles.field}>
      <span sx={styles.label}>
        {props.property.name}
        <Show when={props.property.optional}>
          <button type="button" sx={styles.clear} onClick={props.onClear}>
            Clear
          </button>
        </Show>
      </span>
      <Show when={props.property.description}>
        {(description) => <span sx={styles.description}>{description()}</span>}
      </Show>
      <Show when={props.property.type._tag === "String"}>
        <input
          sx={styles.input}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={() => props.onSet(draft())}
        />
      </Show>
      <Show when={props.property.type._tag === "Int" || props.property.type._tag === "Float"}>
        <input
          sx={styles.input}
          type="number"
          step={props.property.type._tag === "Int" ? "1" : "any"}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={commitNumber}
        />
      </Show>
      <Show when={props.property.type._tag === "Bool"}>
        <input
          sx={styles.checkbox}
          type="checkbox"
          checked={props.value === true}
          onChange={(event) => props.onSet(event.currentTarget.checked)}
        />
      </Show>
    </label>
  );
}
