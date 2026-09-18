import type { DataType } from "@macrograph/plugin/DataType";

import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import {
  filterTypeChoices,
  replaceTypeSegment,
  typeSegments,
  type TypeChoice,
} from "./typeSelection";

const styles = stylex.create({
  root: { minWidth: 0 },
  segments: {
    alignItems: "center",
    backgroundColor: "black",
    borderRadius: 8,
    display: "flex",
    flexWrap: "nowrap",
    fontFamily: "monospace",
    fontSize: 14,
    overflowX: "auto",
    overflowY: "hidden",
    paddingBlock: 1,
  },
  segmentFrame: {
    alignItems: "center",
    backgroundColor: "black",
    borderColor: colors.gray6,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    cursor: "pointer",
    display: "flex",
    flexShrink: 0,
    flexWrap: "nowrap",
    marginBlock: -1,
    paddingInline: 4,
  },
  segment: {
    backgroundColor: "transparent",
    color: colors.gray12,
    maxWidth: "100%",
    outline: "none",
    overflowWrap: "anywhere",
    padding: 4,
    ":focus-visible": { color: colors.focus },
    "@media (pointer: coarse)": { minHeight: 36 },
  },
  selected: {
    borderColor: colors.focus,
    backgroundColor: "color-mix(in srgb, var(--gray-12) 10%, black)",
  },
  menu: {
    position: "fixed",
    zIndex: 100,
    backgroundColor: colors.gray2,
    color: colors.gray12,
    borderRadius: 5,
    borderColor: colors.gray6,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: "0 12px 24px rgb(0 0 0 / .4)",
    padding: 6,
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
  },
  search: {
    width: "100%",
    minWidth: 0,
    borderColor: colors.gray6,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 3,
    backgroundColor: colors.gray1,
    color: colors.gray12,
    padding: 7,
    outline: "none",
    ":focus": { borderColor: colors.focus },
  },
  list: { overflowY: "auto", minHeight: 0 },
  category: {
    color: colors.gray10,
    fontSize: 10,
    fontWeight: 600,
    paddingBlock: 6,
    paddingInline: 4,
  },
  option: {
    display: "block",
    textAlign: "left",
    width: "100%",
    padding: 7,
    borderRadius: 3,
    fontFamily: "monospace",
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    "@media (pointer: coarse)": { minHeight: 36 },
  },
  highlighted: { backgroundColor: colors.gray4, boxShadow: `inset 2px 0 ${colors.focus}` },
  empty: { color: colors.gray10, padding: 10 },
});

let pickerSequence = 0;
export interface DataTypePickerProps {
  readonly value: DataType.Any;
  readonly onChange: (type: DataType.Any) => void;
  readonly label?: string;
  readonly disabled?: boolean;
}

export function DataTypePicker(props: DataTypePickerProps) {
  const id = `data-type-picker-${++pickerSequence}`;
  let root: HTMLDivElement | undefined;
  let menu: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const [depth, setDepth] = createSignal<number | null>(null);
  const [hoveredDepth, setHoveredDepth] = createSignal<number | null>(null);
  const [search, setSearch] = createSignal("");
  const [highlight, setHighlight] = createSignal(0);
  const [position, setPosition] = createSignal({
    left: "0px",
    top: "0px",
    width: "220px",
    maxHeight: "320px",
  });
  const segments = createMemo(() => typeSegments(props.value));
  const choices = createMemo(() => filterTypeChoices(search()));
  createEffect(
    () => choices()[highlight()],
    (choice) => {
      menu
        ?.querySelector<HTMLElement>(`[id="${id}-${choice}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
  );
  const open = (button: HTMLButtonElement, index: number) => {
    if (props.disabled) return;
    trigger = button;
    setSearch("");
    setHighlight(0);
    const bounds = button.getBoundingClientRect();
    const width = Math.min(240, innerWidth - 16);
    const height = Math.min(340, innerHeight - 16);
    setPosition({
      left: `${Math.max(8, Math.min(bounds.left, innerWidth - width - 8))}px`,
      top: `${Math.max(8, Math.min(bounds.bottom + 4, innerHeight - height - 8))}px`,
      width: `${width}px`,
      maxHeight: `${height}px`,
    });
    setDepth(index);
    queueMicrotask(() => searchInput?.focus());
  };
  const close = (restore = false) => {
    setDepth(null);
    if (restore) trigger?.focus();
  };
  const select = (choice: TypeChoice) => {
    const index = depth();
    if (index === null || props.disabled) return;
    props.onChange(replaceTypeSegment(props.value, index, choice));
    close();
    queueMicrotask(() =>
      root?.querySelector<HTMLButtonElement>(`[data-type-depth="${index}"]`)?.focus(),
    );
  };
  createEffect(
    () => props.disabled,
    (disabled) => {
      if (disabled) close();
    },
  );
  createEffect(
    () => depth() !== null,
    (isOpen) => {
      if (!isOpen) return;
      const outside = (event: PointerEvent) => {
        if (!root?.contains(event.target as Node)) close();
      };
      const viewport = () => close(true);
      const scroll = (event: Event) => {
        const target = event.target as Node;
        if (!menu?.contains(target) && !root?.contains(target)) close();
      };
      document.addEventListener("pointerdown", outside);
      window.addEventListener("resize", viewport);
      window.addEventListener("scroll", scroll, true);
      return () => {
        document.removeEventListener("pointerdown", outside);
        window.removeEventListener("resize", viewport);
        window.removeEventListener("scroll", scroll, true);
      };
    },
  );

  function Segment(segmentProps: { readonly index: number }) {
    return (
      <div
        data-type-frame={segmentProps.index}
        sx={[
          styles.segmentFrame,
          depth() === segmentProps.index || hoveredDepth() === segmentProps.index
            ? styles.selected
            : null,
        ]}
        onMouseMove={(event) => {
          event.stopPropagation();
          setHoveredDepth(segmentProps.index);
        }}
        onMouseLeave={(event) => {
          event.stopPropagation();
          setHoveredDepth(null);
        }}
      >
        <button
          type="button"
          disabled={props.disabled}
          data-type-depth={segmentProps.index}
          sx={styles.segment}
          aria-label={`${props.label ?? "Data type"}, ${segmentProps.index === 0 ? "outer" : `nested ${segmentProps.index}`}: ${segments()[segmentProps.index]?._tag}`}
          aria-haspopup="listbox"
          aria-expanded={depth() === segmentProps.index ? "true" : "false"}
          aria-controls={depth() === segmentProps.index ? id : undefined}
          onClick={(event) =>
            depth() === segmentProps.index
              ? close(true)
              : open(event.currentTarget, segmentProps.index)
          }
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              open(event.currentTarget, segmentProps.index);
            }
          }}
        >
          {segments()[segmentProps.index]?._tag}
        </button>
        <Show when={segmentProps.index + 1 < segments().length}>
          <Segment index={segmentProps.index + 1} />
        </Show>
      </div>
    );
  }

  return (
    <div
      ref={root}
      sx={styles.root}
      data-component="data-type-picker"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && depth() !== null) {
          event.preventDefault();
          close(true);
        }
      }}
      onFocusOut={(event) => {
        if (!root?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <div sx={styles.segments} role="group" aria-label={props.label ?? "Data type"}>
        <Segment index={0} />
      </div>
      <Show when={depth() !== null}>
        <div ref={menu} sx={styles.menu} style={position()}>
          <input
            ref={searchInput}
            sx={styles.search}
            role="combobox"
            aria-label="Search data types"
            aria-controls={id}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={
              choices()[highlight()] ? `${id}-${choices()[highlight()]}` : undefined
            }
            placeholder="Search data types"
            value={search()}
            onInput={(event) => {
              setSearch(event.currentTarget.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((current) =>
                  Math.max(
                    0,
                    Math.min(choices().length - 1, current + (event.key === "ArrowDown" ? 1 : -1)),
                  ),
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                const choice = choices()[highlight()];
                if (choice) select(choice);
              } else if (event.key === "Tab") {
                trigger?.focus();
                close();
              }
            }}
          />
          <div id={id} role="listbox" aria-label="Data types" sx={styles.list}>
            <For
              each={choices()}
              fallback={
                <div role="status" sx={styles.empty}>
                  No data types found
                </div>
              }
            >
              {(choice, index) => (
                <>
                  <Show when={index() === 0 || choice === "List"}>
                    <div sx={styles.category}>
                      {choice === "List" || choice === "Option" ? "Containers" : "Primitives"}
                    </div>
                  </Show>
                  <button
                    type="button"
                    role="option"
                    id={`${id}-${choice}`}
                    tabindex={-1}
                    aria-selected={segments()[depth() ?? 0]?._tag === choice ? "true" : "false"}
                    sx={[styles.option, highlight() === index() ? styles.highlighted : null]}
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => setHighlight(index())}
                    onClick={() => select(choice)}
                  >
                    {choice}
                  </button>
                </>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
