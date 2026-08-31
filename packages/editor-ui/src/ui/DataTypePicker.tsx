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
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 3,
    padding: 3,
    backgroundColor: "black",
    borderRadius: 8,
    borderColor: colors.gray6,
    borderStyle: "solid",
    borderWidth: 1,
  },
  segment: {
    fontFamily: "monospace",
    fontSize: 12,
    borderRadius: 6,
    borderColor: colors.gray6,
    borderStyle: "solid",
    borderWidth: 1,
    paddingBlock: 5,
    paddingInline: 6,
    backgroundColor: { default: "black", ":hover": colors.gray4 },
    color: colors.gray12,
    outline: "none",
    ":focus-visible": { borderColor: colors.focus },
    "@media (pointer: coarse)": { minHeight: 36 },
  },
  selected: {
    borderColor: colors.focus,
    backgroundColor: "color-mix(in srgb, var(--gray-12) 10%, black)",
  },
  arrow: { color: colors.gray10, fontSize: 10, marginLeft: 5 },
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
        if (!menu?.contains(event.target as Node)) close();
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
        <For each={segments().map((_, index) => index)}>
          {(index) => (
            <button
              type="button"
              disabled={props.disabled}
              data-type-depth={index}
              sx={[styles.segment, depth() === index ? styles.selected : null]}
              aria-label={`${props.label ?? "Data type"}, ${index === 0 ? "outer" : `nested ${index}`}: ${segments()[index]?._tag}`}
              aria-haspopup="listbox"
              aria-expanded={depth() === index ? "true" : "false"}
              aria-controls={depth() === index ? id : undefined}
              onClick={(event) =>
                depth() === index ? close(true) : open(event.currentTarget, index)
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  open(event.currentTarget, index);
                }
              }}
            >
              {segments()[index]?._tag}
              <span sx={styles.arrow} aria-hidden="true">
                {segments()[index]?._tag === "List" || segments()[index]?._tag === "Option"
                  ? ">"
                  : "v"}
              </span>
            </button>
          )}
        </For>
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
