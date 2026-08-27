import type { Package, SchemaRef } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal, onSettled } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { rankedSearch } from "../catalog/search";
import { searchMarker } from "../markers.stylex.ts";

const enter = stylex.keyframes({
  from: { opacity: 0, transform: "scale(.95)" },
  to: { opacity: 1, transform: "scale(1)" },
});
const exit = stylex.keyframes({
  from: { opacity: 1, transform: "scale(1)" },
  to: { opacity: 0, transform: "scale(.95)" },
});

const styles = stylex.create({
  root: {
    backgroundColor: colors.gray3,
    borderColor: colors.gray5,
    borderRadius: 4,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    display: "flex",
    flexDirection: "column",
    fontSize: 14,
    height: "min(22rem, calc(100dvh - 1rem))",
    overflow: "hidden",
    position: "fixed",
    transformOrigin: "top left",
    width: "min(18rem, calc(100vw - 1rem))",
    zIndex: 50,
  },
  showing: {
    animationDuration: { default: "150ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
    animationName: enter,
  },
  hiding: {
    animationDuration: { default: "100ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
    animationName: exit,
    pointerEvents: "none",
  },
  focus: {
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  search: {
    alignItems: "center",
    backgroundColor: colors.gray2,
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexShrink: 0,
    height: 32,
  },
  searchIcon: {
    color: {
      default: colors.gray9,
      [stylex.when.ancestor(":focus-within", searchMarker)]: colors.focus,
    },
    flexShrink: 0,
    height: 12,
    marginLeft: 8,
    width: 12,
  },
  input: {
    backgroundColor: "transparent",
    color: colors.gray12,
    flex: 1,
    fontSize: 13,
    height: "100%",
    minWidth: 0,
    outline: "none",
    paddingInline: 6,
    "::placeholder": { color: colors.gray9 },
  },
  list: {
    flex: 1,
    minHeight: 0,
    overscrollBehavior: "contain",
    overflowY: "auto",
    paddingBottom: 4,
    paddingInline: 4,
  },
  empty: {
    color: colors.gray11,
    fontSize: 12,
    fontStyle: "italic",
    padding: 12,
    textAlign: "center",
  },
  packageGroup: { marginTop: { default: 4, ":first-child": 0 } },
  packageName: {
    backgroundColor: colors.gray3,
    color: colors.gray11,
    fontSize: 11,
    fontWeight: 500,
    paddingBlock: 4,
    paddingInline: 4,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  option: {
    alignItems: "center",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.gray5,
      ":focus-visible": colors.gray5,
    },
    borderRadius: 4,
    color: colors.gray12,
    display: "flex",
    flexDirection: "row",
    gap: 8,
    paddingBlock: 4,
    paddingInline: 4,
    textAlign: "left",
    width: "100%",
    minHeight: { default: null, "@media (pointer: coarse)": 40 },
  },
  coarsePadding: { paddingInline: { default: 4, "@media (pointer: coarse)": 8 } },
  dot: { borderRadius: "50%", height: 12, width: 12 },
  event: { backgroundColor: "#b91c1c" },
  exec: { backgroundColor: "#2563eb" },
  pure: { backgroundColor: "#047857" },
  schemaName: {
    fontSize: 12,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

export function NodeCreationMenu(props: {
  packages: ReadonlyArray<Package.Model>;
  screenPosition: { x: number; y: number };
  schemaFilter?: (schema: Package.SchemaModel) => boolean;
  hiding?: boolean;
  ref?: (element: HTMLDivElement) => void;
  onCreate: (schema: SchemaRef, name: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = createSignal("");
  let root: HTMLDivElement | undefined;

  const packages = () => {
    return props.packages
      .map((pkg) => ({
        ...pkg,
        schemas: rankedSearch(
          search(),
          pkg.schemas
            .filter((schema) => props.schemaFilter?.(schema) ?? true)
            .map((schema) => ({
              item: schema,
              key: `${pkg.id}:${schema.id}`,
              fields: [schema.name, schema.id, schema.description, pkg.name, pkg.id],
              terms: [schema.type],
            })),
        ),
      }))
      .filter((pkg) => pkg.schemas.length > 0);
  };

  onSettled(() => {
    if (!matchMedia("(pointer: coarse)").matches)
      queueMicrotask(() => root?.querySelector("input")?.focus());
    const close = (event: PointerEvent) => {
      if (!root?.contains(event.target as globalThis.Node)) props.onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  });

  return (
    <div
      role="dialog"
      aria-label="Create node"
      ref={(element) => {
        root = element;
        props.ref?.(element);
      }}
      sx={[styles.root, props.hiding ? styles.hiding : styles.showing]}
      style={{
        left: `${Math.max(8, Math.min(innerWidth - Math.min(288, innerWidth - 16) - 8, props.screenPosition.x - 16))}px`,
        top: `${Math.max(8, Math.min(innerHeight - Math.min(352, innerHeight - 16) - 8, props.screenPosition.y - 16))}px`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div sx={[searchMarker, styles.search]}>
        <IconTablerSearch aria-hidden="true" {...stylex.attrs(styles.searchIcon)} />
        <input
          sx={styles.input}
          aria-label="Search nodes"
          placeholder="Search nodes"
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
      </div>
      <div sx={styles.list} onWheel={(event) => event.stopPropagation()}>
        <Show
          when={packages().length > 0}
          fallback={<div sx={styles.empty}>No schemas found.</div>}
        >
          <For each={packages()}>
            {(pkg) => (
              <section sx={styles.packageGroup}>
                <div sx={styles.packageName}>{pkg.name}</div>
                <For each={pkg.schemas}>
                  {(schema) => (
                    <button
                      type="button"
                      sx={[styles.focus, styles.option, styles.coarsePadding]}
                      title={
                        schema.description
                          ? `${schema.name}\n${schema.description}`
                          : schema.name
                      }
                      onClick={() => {
                        props.onCreate({ package: pkg.id, schema: schema.id }, schema.name);
                        props.onClose();
                      }}
                    >
                      <span
                        sx={[
                          styles.dot,
                          schema.type === "event"
                            ? styles.event
                            : schema.type === "exec"
                              ? styles.exec
                              : styles.pure,
                        ]}
                      />
                      <span sx={styles.schemaName}>{schema.name}</span>
                    </button>
                  )}
                </For>
              </section>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
