import type { Package } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { createMemo, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";

const styles = stylex.create({
  panel: {
    alignItems: "stretch",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 0,
    overflowY: "auto",
    padding: 8,
  },
  title: { color: colors.gray12, fontSize: 12, fontWeight: 600 },
  description: { color: colors.gray11, fontSize: 12, lineHeight: 1.45, margin: 0 },
  fields: { display: "flex", flexDirection: "column", gap: 8 },
  field: { display: "flex", flexDirection: "column", gap: 2 },
  fieldLabel: { color: colors.gray11, fontSize: 11, fontWeight: 500 },
  value: { color: colors.gray12, fontSize: 12, overflowWrap: "anywhere" },
  breakdown: { display: "grid", gap: 4, gridTemplateColumns: "1fr auto" },
  breakdownLabel: { color: colors.gray11, fontSize: 11, textTransform: "capitalize" },
  breakdownValue: { color: colors.gray12, fontSize: 11, fontVariantNumeric: "tabular-nums" },
});

const schemaTypes = ["event", "exec", "pure", "base"] as const;

export function ModuleInfo(props: { module: Package.Model }) {
  const publicSchemas = createMemo(() =>
    props.module.schemas.filter((schema) => schema.internal !== true),
  );
  const schemaCounts = createMemo(() =>
    schemaTypes.map((type) => ({
      type,
      count: publicSchemas().filter((schema) => schema.type === type).length,
    })),
  );

  return (
    <div sx={styles.panel} data-component="module-info">
      <span sx={styles.title}>Module</span>
      <Show when={props.module.description}>
        {(description) => <p sx={styles.description}>{description()}</p>}
      </Show>
      <div sx={styles.fields}>
        <div sx={styles.field}>
          <span sx={styles.fieldLabel}>Name</span>
          <span sx={styles.value}>{props.module.name}</span>
        </div>
        <div sx={styles.field}>
          <span sx={styles.fieldLabel}>ID</span>
          <span sx={styles.value}>{props.module.id}</span>
        </div>
        <div sx={styles.field}>
          <span sx={styles.fieldLabel}>Schemas</span>
          <span sx={styles.value}>{publicSchemas().length}</span>
        </div>
        <Show when={publicSchemas().length > 0}>
          <div sx={styles.breakdown} aria-label="Schema breakdown">
            <For each={schemaCounts().filter(({ count }) => count > 0)}>
              {({ type, count }) => (
                <>
                  <span sx={styles.breakdownLabel}>{type}</span>
                  <span sx={styles.breakdownValue}>{count}</span>
                </>
              )}
            </For>
          </div>
        </Show>
        <div sx={styles.field}>
          <span sx={styles.fieldLabel}>Resources</span>
          <span sx={styles.value}>{props.module.resources.length}</span>
        </div>
      </div>
    </div>
  );
}
