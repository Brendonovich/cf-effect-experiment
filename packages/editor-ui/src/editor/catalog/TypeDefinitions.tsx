import { TypeDefinition, type Project } from "@macrograph/core";
import { DataType } from "@macrograph/plugin/DataType";
import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { Button } from "../../ui/Button";
import { DataTypePicker } from "../../ui/DataTypePicker";

const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 8,
    fontSize: 12,
    minWidth: 0,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 8,
    backgroundColor: colors.gray2,
    borderRadius: 4,
    minWidth: 0,
  },
  row: { display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" },
  input: {
    minWidth: 0,
    width: "100%",
    padding: 6,
    backgroundColor: colors.gray1,
    color: colors.gray12,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 3,
    outline: "none",
    ":focus": { borderColor: colors.focus },
  },
  muted: { color: colors.gray11, fontSize: 11, overflowWrap: "anywhere" },
  warning: {
    color: colors.red11,
    backgroundColor: colors.red2,
    padding: 8,
    borderRadius: 4,
    overflowWrap: "anywhere",
  },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    borderLeft: `1px solid ${colors.gray6}`,
    paddingLeft: 6,
  },
});

type Field = typeof DataType.Field.Type;
function Fields(props: {
  fields: readonly Field[];
  definitions: DataType.Definitions;
  disabled: boolean;
  onChange: (fields: readonly Field[]) => void;
}) {
  const update = (index: number, field: Field) =>
    props.onChange(props.fields.map((item, i) => (i === index ? field : item)));
  return (
    <div sx={styles.fields}>
      <For each={props.fields.map((_, index) => index)}>
        {(index) => (
          <div sx={styles.card} data-type-field={index}>
            <input
              sx={styles.input}
              aria-label={`Field ${index + 1} name`}
              value={props.fields[index]?.name ?? ""}
              disabled={props.disabled}
              onInput={(event) => {
                const field = props.fields[index];
                if (field) update(index, { ...field, name: event.currentTarget.value });
              }}
            />
            <DataTypePicker
              value={props.fields[index]?.type ?? DataType.String}
              definitions={props.definitions}
              disabled={props.disabled}
              label={`Field ${index + 1} type`}
              onChange={(type) => {
                const field = props.fields[index];
                if (field) update(index, { ...field, type });
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="text"
              disabled={props.disabled}
              onClick={() => props.onChange(props.fields.filter((_, i) => i !== index))}
            >
              Remove field {index + 1}
            </Button>
          </div>
        )}
      </For>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={props.disabled}
        onClick={() => props.onChange([...props.fields, { name: "", type: DataType.String }])}
      >
        Add field
      </Button>
    </div>
  );
}

export function TypeDefinitions(props: {
  project: Pick<Project.Model, "types" | "graphs"> | null;
  search: string;
  canEdit: boolean;
  onPreview: (change: TypeDefinition.Change) => Promise<TypeDefinition.Impact>;
  onConfirm: (token: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = createSignal<DataType.Definition | null>(null);
  const [impact, setImpact] = createSignal<TypeDefinition.Impact | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const definitions = createMemo(() => props.project?.types ?? {});
  const choices = createMemo(() => {
    const value = draft();
    return value ? { ...definitions(), [value.id]: value } : definitions();
  });
  const diagnostics = createMemo(() => TypeDefinition.validate(definitions()));
  const disabled = () => busy() || impact() !== null || !props.canEdit;
  const preview = async (change: TypeDefinition.Change) => {
    if (busy() || !props.canEdit) return;
    setBusy(true);
    setError("");
    try {
      setImpact(await props.onPreview(change));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    const pending = impact();
    if (!pending || busy() || !props.canEdit) return;
    setBusy(true);
    setError("");
    try {
      await props.onConfirm(pending.token);
      setImpact(null);
      setDraft(null);
    } catch (cause) {
      setError(`${String(cause)}. Preview the change again before confirming.`);
      setImpact(null);
    } finally {
      setBusy(false);
    }
  };
  const create = (kind: "Struct" | "Enum") => {
    setError("");
    setImpact(null);
    const base = { id: DataType.DefinitionId.make(crypto.randomUUID()), name: "" };
    setDraft(
      kind === "Struct"
        ? { ...base, _tag: "Struct", fields: [] }
        : { ...base, _tag: "Enum", variants: [{ name: "", fields: [] }] },
    );
  };
  return (
    <section
      sx={styles.panel}
      aria-label="Project types"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p sx={styles.muted}>
        Named project types keep their identity when renamed. Generated operations appear in the
        node menu automatically.
      </p>
      <div sx={styles.row}>
        <Button type="button" size="sm" disabled={disabled()} onClick={() => create("Struct")}>
          New struct
        </Button>
        <Button type="button" size="sm" disabled={disabled()} onClick={() => create("Enum")}>
          New enum
        </Button>
      </div>
      <Show when={error()}>
        <div role="alert" sx={styles.warning}>
          {error()}
        </div>
      </Show>
      <Show when={draft()}>
        {(value) => (
          <div sx={styles.card} aria-label="Type authoring">
            <strong>
              {definitions()[value().id] ? "Edit" : "Create"}{" "}
              {value()._tag === "Struct" ? "struct" : "tagged enum"}
            </strong>
            <label>
              Name
              <input
                sx={styles.input}
                aria-label="Type name"
                value={value().name}
                disabled={disabled()}
                onInput={(event) => setDraft({ ...value(), name: event.currentTarget.value })}
              />
            </label>
            <div sx={styles.muted}>
              Identity: <code>{value().id}</code>
            </div>
            <Show
              when={
                value()._tag === "Struct"
                  ? (value() as Extract<DataType.Definition, { _tag: "Struct" }>)
                  : undefined
              }
            >
              {(struct) => (
                <Fields
                  fields={struct().fields}
                  definitions={choices()}
                  disabled={disabled()}
                  onChange={(fields) => setDraft({ ...struct(), fields })}
                />
              )}
            </Show>
            <Show
              when={
                value()._tag === "Enum"
                  ? (value() as Extract<DataType.Definition, { _tag: "Enum" }>)
                  : undefined
              }
            >
              {(enumeration) => (
                <>
                  <For each={enumeration().variants.map((_, index) => index)}>
                    {(index) => (
                      <div sx={styles.card} data-type-variant={index}>
                        <input
                          sx={styles.input}
                          aria-label={`Variant ${index + 1} name`}
                          value={enumeration().variants[index]?.name ?? ""}
                          disabled={disabled()}
                          onInput={(event) =>
                            setDraft({
                              ...enumeration(),
                              variants: enumeration().variants.map((variant, i) =>
                                i === index
                                  ? { ...variant, name: event.currentTarget.value }
                                  : variant,
                              ),
                            })
                          }
                        />
                        <Fields
                          fields={enumeration().variants[index]?.fields ?? []}
                          definitions={choices()}
                          disabled={disabled()}
                          onChange={(fields) =>
                            setDraft({
                              ...enumeration(),
                              variants: enumeration().variants.map((variant, i) =>
                                i === index ? { ...variant, fields } : variant,
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="text"
                          disabled={disabled()}
                          onClick={() =>
                            setDraft({
                              ...enumeration(),
                              variants: enumeration().variants.filter((_, i) => i !== index),
                            })
                          }
                        >
                          Remove variant {index + 1}
                        </Button>
                      </div>
                    )}
                  </For>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={disabled()}
                    onClick={() =>
                      setDraft({
                        ...enumeration(),
                        variants: [...enumeration().variants, { name: "", fields: [] }],
                      })
                    }
                  >
                    Add variant
                  </Button>
                </>
              )}
            </Show>
            <div sx={styles.row}>
              <Button
                type="button"
                size="sm"
                disabled={disabled()}
                onClick={() => void preview({ _tag: "Upsert", definition: value() })}
              >
                Preview changes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy()}
                onClick={() => {
                  setDraft(null);
                  setImpact(null);
                  setError("");
                }}
              >
                Cancel editing
              </Button>
            </div>
          </div>
        )}
      </Show>
      <Show when={impact()}>
        {(pending) => (
          <div role="dialog" aria-label="Confirm type changes" sx={styles.card}>
            <strong>
              {pending().change._tag === "Delete" ? "Delete type?" : "Confirm type changes?"}
            </strong>
            <p sx={styles.warning}>
              Existing nodes, wires, and defaults are preserved. Incompatible values or missing pins
              remain invalid until you explicitly repair or remove them.
            </p>
            <strong>Dependent types ({pending().affectedTypes.length})</strong>
            <For each={pending().affectedTypes} fallback={<span sx={styles.muted}>None</span>}>
              {(id) => (
                <span sx={styles.muted}>
                  {definitions()[id]?.name ?? id} ({id})
                </span>
              )}
            </For>
            <strong>Impacted nodes ({pending().nodes.length})</strong>
            <For each={pending().nodes} fallback={<span sx={styles.muted}>None</span>}>
              {(node) => (
                <div sx={styles.muted}>
                  {props.project?.graphs[node.graphId]?.name ?? node.graphId} /{" "}
                  {props.project?.graphs[node.graphId]?.nodes[node.nodeId]?.name ?? node.nodeId}
                  <For each={node.reasons}>{(reason) => <div>{reason}</div>}</For>
                </div>
              )}
            </For>
            <div sx={styles.row}>
              <Button
                type="button"
                size="sm"
                disabled={busy() || !props.canEdit}
                onClick={() => void confirm()}
              >
                Confirm changes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy()}
                onClick={() => {
                  setImpact(null);
                  setError("");
                }}
              >
                Cancel changes
              </Button>
            </div>
          </div>
        )}
      </Show>
      <For
        each={Object.values(definitions()).filter((definition) =>
          `${definition.name} ${definition.id}`
            .toLowerCase()
            .includes(props.search.trim().toLowerCase()),
        )}
        fallback={<span sx={styles.muted}>No project types found.</span>}
      >
        {(definition) => (
          <div sx={styles.card}>
            <strong>{definition.name}</strong>
            <span sx={styles.muted}>
              {definition._tag} / {definition.id}
            </span>
            <For each={diagnostics().filter((diagnostic) => diagnostic.id === definition.id)}>
              {(diagnostic) => <span sx={styles.warning}>{diagnostic.reason}</span>}
            </For>
            <div sx={styles.row}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled()}
                aria-label={`Edit type ${definition.name}`}
                onClick={() => {
                  setDraft(definition);
                  setError("");
                }}
              >
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="text"
                disabled={disabled()}
                aria-label={`Delete type ${definition.name}`}
                onClick={() => void preview({ _tag: "Delete", id: definition.id })}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </For>
    </section>
  );
}
