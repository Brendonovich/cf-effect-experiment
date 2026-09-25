import type { Function as GraphFunction, Package } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { Show, createSignal } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { Select } from "../../ui/Select";

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
  property: Extract<
    Package.PropertyDefinition,
    { readonly type: unknown } | { readonly function: true }
  >;
  functions?: ReadonlyArray<GraphFunction.Model>;
  options?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
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
    if (!("type" in props.property)) return;
    const value = Number(draft());
    const valid =
      draft().trim() !== "" &&
      Number.isFinite(value) &&
      (props.property.type._tag !== "Int" || Number.isSafeInteger(value));
    if (valid) props.onSet(value);
    else setDraft(formatValue());
  };

  return (
    <div sx={styles.field}>
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
      <Show when={"function" in props.property}>
        <Select
          options={(props.functions ?? []).map((fn) => ({
            id: fn.canvas.id,
            name: fn.canvas.name,
          }))}
          value={typeof props.value === "string" ? props.value : ""}
          valid={(props.functions ?? []).some((fn) => fn.canvas.id === props.value)}
          placeholder="Select function"
          missingLabel="Missing function"
          onChange={props.onSet}
        />
      </Show>
      <Show when={props.options}>
        {(options) => (
          <Select
            options={options()}
            value={typeof props.value === "string" ? props.value : ""}
            valid={options().some((option) => option.id === props.value)}
            placeholder={`Select ${props.property.name.toLowerCase()}`}
            onChange={props.onSet}
          />
        )}
      </Show>
      <Show
        when={
          props.options === undefined &&
          "type" in props.property &&
          props.property.type._tag === "String"
        }
      >
        <input
          sx={styles.input}
          aria-label={props.property.name}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={() => props.onSet(draft())}
        />
      </Show>
      <Show
        when={
          "type" in props.property &&
          (props.property.type._tag === "Int" || props.property.type._tag === "Float")
        }
      >
        <input
          sx={styles.input}
          aria-label={props.property.name}
          type="number"
          step={"type" in props.property && props.property.type._tag === "Int" ? "1" : "any"}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={commitNumber}
        />
      </Show>
      <Show when={"type" in props.property && props.property.type._tag === "Bool"}>
        <input
          sx={styles.checkbox}
          aria-label={props.property.name}
          type="checkbox"
          checked={props.value === true}
          onChange={(event) => props.onSet(event.currentTarget.checked)}
        />
      </Show>
    </div>
  );
}
