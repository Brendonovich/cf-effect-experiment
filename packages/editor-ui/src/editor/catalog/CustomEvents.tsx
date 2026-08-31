import { CustomEvent } from "@macrograph/core";
import { DataType } from "@macrograph/plugin/DataType";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { Button } from "../../ui/Button";

const styles = stylex.create({
  root: { padding: 8, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 },
  card: {
    backgroundColor: colors.gray2,
    borderColor: colors.gray6,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 4,
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  row: { display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" },
  input: {
    backgroundColor: colors.gray3,
    borderColor: colors.gray6,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 3,
    padding: 4,
    minWidth: 0,
    width: "100%",
    color: colors.gray12,
  },
  muted: { color: colors.gray10, lineHeight: "18px" },
  error: { color: colors.red11 },
});

function FieldType(props: { value: DataType.Any; onChange: (type: DataType.Any) => void }) {
  return (
    <div sx={styles.row}>
      <select
        aria-label="Field type"
        sx={styles.input}
        value={props.value._tag}
        onChange={(event) => {
          const tag = event.currentTarget.value;
          if (tag === "List") props.onChange(DataType.List(DataType.String));
          else if (tag === "Option") props.onChange(DataType.Option(DataType.String));
          else if (
            tag === "String" ||
            tag === "Int" ||
            tag === "Float" ||
            tag === "Bool" ||
            tag === "DateTime"
          )
            props.onChange(DataType[tag]);
        }}
      >
        <For each={["String", "Int", "Float", "Bool", "DateTime", "List", "Option"]}>
          {(type) => <option value={type}>{type}</option>}
        </For>
      </select>
      <Show when={props.value._tag === "List" || props.value._tag === "Option"}>
        <FieldType
          value={
            props.value._tag === "List"
              ? props.value.item
              : props.value._tag === "Option"
                ? props.value.inner
                : DataType.String
          }
          onChange={(inner) =>
            props.onChange(
              props.value._tag === "List" ? DataType.List(inner) : DataType.Option(inner),
            )
          }
        />
      </Show>
    </div>
  );
}

export function CustomEvents(props: {
  events: Readonly<Record<string, CustomEvent.Model>>;
  search: string;
  canEdit: boolean;
  put: (event: CustomEvent.Model) => Promise<void>;
  remove: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = createSignal<CustomEvent.Model | null>(null);
  const [error, setError] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const submit = async (operation: () => Promise<void>) => {
    if (pending() || !props.canEdit) return;
    setError("");
    setPending(true);
    try {
      await operation();
      setDraft(null);
    } catch (error) {
      setError(
        typeof error === "object" && error !== null && "reason" in error
          ? String(error.reason)
          : typeof error === "object" &&
              error !== null &&
              "_tag" in error &&
              error._tag === "CustomEventInUse"
            ? "Delete this event's Emit and On nodes before deleting the event."
            : error instanceof Error
              ? error.message || error.name
              : String(error),
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <div sx={styles.root} data-component="custom-events">
      <p sx={styles.muted}>
        Project-wide typed events. Emit launches each On handler independently. Delete nodes before
        deleting an event.
      </p>
      <Show when={props.canEdit}>
        <Button
          disabled={pending()}
          onClick={() => {
            setError("");
            setDraft({ id: crypto.randomUUID(), name: "New Event", fields: [] });
          }}
        >
          New event
        </Button>
      </Show>
      <Show when={error()}>
        <p role="alert" sx={styles.error}>
          {error()}
        </p>
      </Show>
      <For
        each={Object.values(props.events).filter((event) =>
          event.name.toLowerCase().includes(props.search.toLowerCase()),
        )}
      >
        {(event) => (
          <section sx={styles.card}>
            <strong>{event.name}</strong>
            <For each={event.fields}>
              {(field) => (
                <span sx={styles.muted}>
                  {field.name}: {field.type._tag}
                </span>
              )}
            </For>
            <Show when={props.canEdit}>
              <div sx={styles.row}>
                <Button
                  disabled={pending()}
                  onClick={() => {
                    setError("");
                    setDraft(structuredClone(event));
                  }}
                >
                  Edit {event.name}
                </Button>
                <Button
                  disabled={pending()}
                  onClick={() => void submit(() => props.remove(event.id))}
                >
                  Delete {event.name}
                </Button>
              </div>
            </Show>
          </section>
        )}
      </For>
      <Show when={draft()}>
        {(event) => (
          <form
            sx={styles.card}
            onSubmit={(e) => {
              e.preventDefault();
              void submit(() => props.put(event()));
            }}
          >
            <label>
              Event name
              <input
                required
                aria-label="Event name"
                sx={styles.input}
                value={event().name}
                onInput={(e) => setDraft({ ...event(), name: e.currentTarget.value })}
              />
            </label>
            <For each={event().fields}>
              {(field) => (
                <div sx={styles.card}>
                  <input
                    required
                    aria-label="Field name"
                    sx={styles.input}
                    value={field.name}
                    onInput={(e) =>
                      setDraft({
                        ...event(),
                        fields: event().fields.map((item) =>
                          item.id === field.id ? { ...item, name: e.currentTarget.value } : item,
                        ),
                      })
                    }
                  />
                  <FieldType
                    value={field.type}
                    onChange={(type) =>
                      setDraft({
                        ...event(),
                        fields: event().fields.map((item) =>
                          item.id === field.id ? { ...item, type } : item,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...event(),
                        fields: event().fields.filter((item) => item.id !== field.id),
                      })
                    }
                  >
                    Remove field
                  </Button>
                </div>
              )}
            </For>
            <Button
              type="button"
              onClick={() =>
                setDraft({
                  ...event(),
                  fields: [
                    ...event().fields,
                    {
                      id: crypto.randomUUID(),
                      name: `field${event().fields.length + 1}`,
                      type: DataType.String,
                    },
                  ],
                })
              }
            >
              Add field
            </Button>
            <p sx={styles.muted}>
              Changing field types removes incompatible connections and defaults. Saving replaces
              the event definition for all collaborators.
            </p>
            <Button type="submit" disabled={pending() || !props.canEdit}>
              Save event
            </Button>
            <Button type="button" disabled={pending()} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </form>
        )}
      </Show>
    </div>
  );
}
