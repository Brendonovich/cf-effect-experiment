import type { SchemaAuthoring, Package } from "@macrograph/core";
import type { DataType } from "@macrograph/module/DataType";

import * as stylex from "@stylexjs/stylex";
import { createMemo, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { Select } from "../../ui/Select";

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { color: colors.gray11, fontSize: 11, fontWeight: 500 },
  hint: { color: colors.gray11, fontSize: 11 },
  heading: { display: "flex", alignItems: "center", justifyContent: "space-between" },
});

export function SourceProperty(props: {
  source: SchemaAuthoring.PropertySource;
  property: Package.PropertyDefinition;
  properties: Readonly<Record<string, unknown>>;
  definitions: DataType.Definitions;
  disabled: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const selected = () => {
    const value = props.properties[props.property.id];
    return typeof value === "string" ? value : "";
  };
  const options = createMemo(() =>
    props.source.options({
      properties: props.properties,
      definitions: props.definitions,
    }),
  );

  return (
    <div role="group" aria-label={props.source.ariaLabel ?? props.property.name} sx={styles.field}>
      <div sx={styles.heading}>
        <span sx={styles.label}>{props.property.name}</span>
        <Show when={props.property.optional}>
          <button type="button" disabled={props.disabled} onClick={props.onClear}>
            Clear
          </button>
        </Show>
      </div>
      <Select
        options={options()}
        value={selected()}
        valid={options().some((option) => option.id === selected())}
        placeholder={props.source.placeholder}
        unavailableLabel={props.source.unavailableLabel}
        missingLabel={`Unavailable: ${selected()}`}
        disabled={props.disabled}
        searchable
        onChange={props.onChange}
      />
      <Show when={props.property.description}>
        {(description) => <span sx={styles.hint}>{description()}</span>}
      </Show>
    </div>
  );
}
