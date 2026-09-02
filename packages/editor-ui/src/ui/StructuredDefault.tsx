import { DataType } from "@macrograph/plugin/DataType";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Button } from "./Button";
import { defaultValueError, initialDefaultValue, valueRecord } from "./defaultValues";
import { typeLabel } from "./typeSelection";

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0, fontSize: 12 },
  children: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    borderLeft: `1px solid ${colors.gray6}`,
    paddingLeft: 6,
    minWidth: 0,
  },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 },
  input: {
    backgroundColor: colors.gray1,
    color: colors.gray12,
    width: "100%",
    minWidth: 0,
    padding: 6,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 3,
    outline: "none",
    ":focus": { borderColor: colors.focus },
  },
  saved: {
    margin: 0,
    maxHeight: 160,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
    fontSize: 10,
  },
  warning: { color: colors.red11, fontSize: 11, overflowWrap: "anywhere" },
  muted: { color: colors.gray11, fontSize: 11 },
});

function ValueFields(props: {
  type: DataType.Any;
  definitions: DataType.Definitions;
  value: unknown;
  label: string;
  disabled: boolean;
  depth: number;
  onChange: (value: unknown) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const record = createMemo(() => valueRecord(props.value));
  const definition = createMemo(() =>
    props.type._tag === "Custom" ? props.definitions[props.type.id] : undefined,
  );
  const fields = createMemo(() => {
    const def = definition();
    return def?._tag === "Struct"
      ? def.fields
      : (def?.variants.find((variant) => variant.name === record()?._tag)?.fields ?? []);
  });
  const list = createMemo(() => (Array.isArray(props.value) ? (props.value as unknown[]) : []));
  const complex = () => ["Custom", "List", "Option"].includes(props.type._tag);
  const valueError = createMemo(() =>
    defaultValueError(props.type, props.value, props.definitions),
  );
  return (
    <div sx={styles.root}>
      <Show when={valueError()}>
        <span sx={styles.warning}>
          Invalid value for {typeLabel(props.type, props.definitions)}
        </span>
        <pre sx={styles.saved}>{JSON.stringify(props.value, null, 2) ?? "Missing value"}</pre>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={props.disabled}
          onClick={() => props.onChange(initialDefaultValue(props.type, props.definitions))}
        >
          Repair {props.label}
        </Button>
      </Show>
      <Show
        when={props.depth < 3 || expanded() || !complex()}
        fallback={
          <Button type="button" size="sm" variant="secondary" onClick={() => setExpanded(true)}>
            Expand {props.label}
          </Button>
        }
      >
        <Show when={props.type._tag === "String" || props.type._tag === "DateTime"}>
          <input
            sx={styles.input}
            aria-label={props.label}
            disabled={props.disabled}
            value={typeof props.value === "string" ? props.value : ""}
            placeholder={
              props.type._tag === "DateTime" ? "ISO date/time, e.g. 2026-08-31T12:00:00Z" : "Text"
            }
            onInput={(event) => props.onChange(event.currentTarget.value)}
          />
          <Show when={props.type._tag === "DateTime"}>
            <span sx={styles.muted}>ISO date/time with timezone</span>
          </Show>
        </Show>
        <Show when={props.type._tag === "Int" || props.type._tag === "Float"}>
          <input
            sx={styles.input}
            type="number"
            aria-label={props.label}
            disabled={props.disabled}
            step={props.type._tag === "Int" ? "1" : "any"}
            value={typeof props.value === "number" ? props.value : ""}
            onInput={(event) =>
              props.onChange(
                event.currentTarget.value === "" ? "" : Number(event.currentTarget.value),
              )
            }
          />
        </Show>
        <Show when={props.type._tag === "Bool"}>
          <label sx={styles.row}>
            <input
              type="checkbox"
              aria-label={props.label}
              disabled={props.disabled}
              checked={props.value === true}
              onChange={(event) => props.onChange(event.currentTarget.checked)}
            />
            {props.label}
          </label>
        </Show>
        <Show when={props.type._tag === "List" ? props.type : undefined}>
          {(type) => (
            <div sx={styles.children}>
              <For each={list().map((_, index) => index)}>
                {(index) => (
                  <div sx={styles.root}>
                    <span sx={styles.muted}>Item {index + 1}</span>
                    <ValueFields
                      type={type().item}
                      definitions={props.definitions}
                      value={list()[index]}
                      label={`${props.label} item ${index + 1}`}
                      disabled={props.disabled}
                      depth={props.depth + 1}
                      onChange={(value) =>
                        props.onChange(list().map((item, i) => (i === index ? value : item)))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="text"
                      disabled={props.disabled}
                      onClick={() => props.onChange(list().filter((_, i) => i !== index))}
                    >
                      Remove item {index + 1}
                    </Button>
                  </div>
                )}
              </For>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={props.disabled}
                onClick={() =>
                  props.onChange([...list(), initialDefaultValue(type().item, props.definitions)])
                }
              >
                Add item
              </Button>
            </div>
          )}
        </Show>
        <Show when={props.type._tag === "Option" ? props.type : undefined}>
          {(type) => (
            <div sx={styles.children}>
              <select
                sx={styles.input}
                aria-label={`${props.label} option`}
                disabled={props.disabled}
                value={record()?._tag === "Some" ? "Some" : "None"}
                onChange={(event) =>
                  props.onChange(
                    event.currentTarget.value === "Some"
                      ? {
                          _tag: "Some",
                          value: initialDefaultValue(type().inner, props.definitions),
                        }
                      : { _tag: "None" },
                  )
                }
              >
                <option value="None">None</option>
                <option value="Some">Some</option>
              </select>
              <Show when={record()?._tag === "Some"}>
                <ValueFields
                  type={type().inner}
                  definitions={props.definitions}
                  value={record()?.value}
                  label={`${props.label} value`}
                  disabled={props.disabled}
                  depth={props.depth + 1}
                  onChange={(value) => props.onChange({ ...record(), _tag: "Some", value })}
                />
              </Show>
            </div>
          )}
        </Show>
        <Show when={props.type._tag === "Custom"}>
          <Show
            when={definition()}
            fallback={
              <span sx={styles.warning}>
                Type definition missing. Restore it in Types, or remove this default.
              </span>
            }
          >
            {(def) => (
              <div sx={styles.children}>
                <span sx={styles.muted}>
                  {def().name} / {def().id}
                </span>
                <Show
                  when={
                    def()._tag === "Enum"
                      ? (def() as Extract<DataType.Definition, { _tag: "Enum" }>)
                      : undefined
                  }
                >
                  {(enumeration) => (
                    <select
                      sx={styles.input}
                      aria-label={`${props.label} variant`}
                      disabled={props.disabled}
                      value={typeof record()?._tag === "string" ? String(record()?._tag) : ""}
                      onChange={(event) => {
                        const variant = enumeration().variants.find(
                          (item) => item.name === event.currentTarget.value,
                        );
                        if (variant)
                          props.onChange({
                            _type: enumeration().id,
                            _tag: variant.name,
                            ...Object.fromEntries(
                              variant.fields.map((field) => [
                                field.name,
                                initialDefaultValue(field.type, props.definitions),
                              ]),
                            ),
                          });
                      }}
                    >
                      <option value="" disabled>
                        Select variant
                      </option>
                      <Show
                        when={
                          typeof record()?._tag === "string" &&
                          !enumeration().variants.some((variant) => variant.name === record()?._tag)
                        }
                      >
                        <option value={String(record()?._tag)}>
                          Missing variant: {String(record()?._tag)}
                        </option>
                      </Show>
                      <For each={enumeration().variants}>
                        {(variant) => <option value={variant.name}>{variant.name}</option>}
                      </For>
                    </select>
                  )}
                </Show>
                <For each={fields()}>
                  {(field) => (
                    <div sx={styles.root}>
                      <span>
                        {field.name}{" "}
                        <span sx={styles.muted}>{typeLabel(field.type, props.definitions)}</span>
                      </span>
                      <ValueFields
                        type={field.type}
                        definitions={props.definitions}
                        value={record()?.[field.name]}
                        label={`${props.label}.${field.name}`}
                        disabled={props.disabled}
                        depth={props.depth + 1}
                        onChange={(value) =>
                          props.onChange({ ...record(), _type: def().id, [field.name]: value })
                        }
                      />
                    </div>
                  )}
                </For>
                <For
                  each={Object.keys(record() ?? {}).filter(
                    (key) =>
                      key !== "_type" &&
                      key !== "_tag" &&
                      !fields().some((field) => field.name === key),
                  )}
                >
                  {(key) => (
                    <div sx={styles.root}>
                      <span sx={styles.warning}>Obsolete field: {key}</span>
                      <pre sx={styles.saved}>{JSON.stringify(record()?.[key], null, 2)}</pre>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={props.disabled}
                        onClick={() =>
                          props.onChange(
                            Object.fromEntries(
                              Object.entries(record() ?? {}).filter(([name]) => name !== key),
                            ),
                          )
                        }
                      >
                        Remove obsolete field {key}
                      </Button>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}

export function StructuredDefault(props: {
  type?: DataType.Any;
  definitions: DataType.Definitions;
  value: unknown;
  present: boolean;
  label: string;
  disabled: boolean;
  onSave: (value: unknown) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal<unknown>(undefined);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const savedError = createMemo(() =>
    props.present
      ? props.type
        ? defaultValueError(props.type, props.value, props.definitions)
        : "Orphan default: its input no longer exists."
      : undefined,
  );
  const draftError = createMemo(() =>
    props.type && editing() ? defaultValueError(props.type, draft(), props.definitions) : undefined,
  );
  const action = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      setEditing(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const start = () => {
    setDraft(
      props.present
        ? props.value
        : props.type
          ? initialDefaultValue(props.type, props.definitions)
          : undefined,
    );
    setEditing(true);
    setError("");
  };
  return (
    <div sx={styles.root} data-default-editor={props.label}>
      <Show when={props.present}>
        <pre sx={styles.saved} aria-label={`Saved ${props.label}`}>
          {JSON.stringify(props.value, null, 2)}
        </pre>
      </Show>
      <Show when={savedError()}>
        <span role="status" sx={styles.warning}>
          Invalid saved default. It is preserved until repaired or removed.
        </span>
        <details sx={styles.warning}>
          <summary>Diagnostic</summary>
          {savedError()}
        </details>
      </Show>
      <Show when={error()}>
        <span role="alert" sx={styles.warning}>
          {error()}
        </span>
      </Show>
      <Show
        when={editing()}
        fallback={
          <div sx={styles.row}>
            <Show when={props.type}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={props.disabled || busy()}
                onClick={start}
              >
                {props.present ? "Edit default" : "Set default"}
              </Button>
            </Show>
            <Show when={props.present}>
              <Button
                type="button"
                size="sm"
                variant="text"
                disabled={props.disabled || busy()}
                onClick={() => void action(props.onRemove)}
              >
                Remove default
              </Button>
            </Show>
          </div>
        }
      >
        <Show when={props.type}>
          {(type) => (
            <>
              <ValueFields
                type={type()}
                definitions={props.definitions}
                value={draft()}
                label={props.label}
                disabled={props.disabled || busy()}
                depth={0}
                onChange={setDraft}
              />
              <Show when={draftError()}>
                <details sx={styles.warning}>
                  <summary>Draft needs repair</summary>
                  {draftError()}
                </details>
              </Show>
              <div sx={styles.row}>
                <Button
                  type="button"
                  size="sm"
                  disabled={props.disabled || busy() || !!draftError()}
                  onClick={() => void action(() => props.onSave(draft()))}
                >
                  Save default
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy()}
                  onClick={() => setEditing(false)}
                >
                  Cancel default
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="text"
                  disabled={props.disabled || busy()}
                  onClick={() => setDraft(initialDefaultValue(type(), props.definitions))}
                >
                  Reset draft
                </Button>
              </div>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
