import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { createPresence } from "./createPresence";
import { createStateMachine } from "./createStateMachine.ts";
import { searchMarker } from "./Select.stylex.ts";

const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});
const exit = stylex.keyframes({
  from: { opacity: 1, transform: "translateY(0)" },
  to: { opacity: 0, transform: "translateY(-4px)" },
});
const styles = stylex.create({
  root: { display: "flex", position: "relative" },
  focus: {
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.gray6,
    borderRadius: 2,
    borderStyle: "solid",
    borderWidth: 1,
    color: colors.gray12,
    display: "flex",
    fontSize: 11,
    height: 22,
    paddingBlock: 2,
    paddingLeft: 6,
    paddingRight: 4,
    width: "100%",
  },
  valid: { borderColor: "transparent" },
  invalid: { borderColor: colors.red9 },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  placeholder: { color: colors.gray11, fontStyle: "italic" },
  chevron: {
    color: colors.gray11,
    flexShrink: 0,
    height: 14,
    transitionDuration: { default: "200ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    transitionProperty: "rotate, opacity",
    transitionTimingFunction: "ease-in-out",
    width: 14,
  },
  rotated: { rotate: "180deg" },
  disabled: { opacity: 0.5 },
  menu: {
    backgroundColor: colors.gray6,
    borderRadius: 4,
    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
    color: colors.gray12,
    display: "flex",
    flexDirection: "column",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: 11,
    maxHeight: 200,
    overflow: "hidden",
    padding: 2,
    position: "fixed",
    zIndex: 50,
  },
  search: {
    alignItems: "center",
    backgroundColor: colors.gray4,
    borderRadius: 2,
    display: "flex",
    flexShrink: 0,
    height: 28,
    marginBottom: 2,
    minWidth: 0,
    width: "100%",
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
  searchInput: {
    backgroundColor: "transparent",
    color: colors.gray12,
    flex: 1,
    fontSize: 11,
    height: "100%",
    minWidth: 0,
    outline: "none",
    paddingInline: 6,
    "::placeholder": { color: colors.gray11 },
  },
  searchClear: {
    color: { default: colors.gray9, ":hover": colors.gray11 },
    display: "grid",
    flexShrink: 0,
    height: 20,
    marginRight: 6,
    placeItems: "center",
    width: 20,
  },
  searchClearIcon: { height: 12, width: 12 },
  options: {
    minHeight: 0,
    overflowY: "auto",
    overscrollBehaviorY: "contain",
    position: "relative",
  },
  group: {
    color: colors.gray11,
    fontSize: 11,
    fontWeight: 500,
    paddingBlock: 3,
    paddingInline: 4,
  },
  empty: { color: colors.gray11, padding: "8px 6px" },
  showing: {
    animationDuration: { default: "150ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
    animationName: enter,
  },
  hiding: {
    animationDuration: { default: "100ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
    animationName: exit,
    pointerEvents: "none",
  },
  option: {
    borderRadius: 2,
    display: "block",
    outline: "none",
    paddingBlock: 2,
    paddingInline: 4,
    textAlign: "left",
    width: "100%",
    backgroundColor: { default: "transparent", ":hover": "#2563eb" },
  },
  highlighted: { backgroundColor: "#2563eb" },
});

export interface SelectOption {
  readonly id: string;
  readonly name: string;
  readonly group?: string;
}

export interface SelectTriggerProps {
  readonly ref: (element: HTMLButtonElement) => void;
  readonly isOpen: () => boolean;
  readonly disabled: () => boolean;
  readonly toggle: () => void;
}

export function Select(props: {
  appearance?: stylex.StyleXStyles;
  options: ReadonlyArray<SelectOption>;
  value: string;
  valid: boolean;
  placeholder: string;
  unavailableLabel?: string;
  missingLabel?: string;
  disabled?: boolean;
  searchable?: boolean;
  menuMinWidth?: number;
  trigger?: (props: SelectTriggerProps) => JSX.Element;
  onOpenChange?: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  let root: HTMLSpanElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const searchable = () => props.searchable ?? props.options.length > 10;
  const [search, setSearch] = createSignal("");
  const options = createMemo(() => {
    const query = searchable() ? search().trim().toLowerCase() : "";
    return query === ""
      ? props.options
      : props.options.filter(
          (option) =>
            option.name.toLowerCase().includes(query) || option.id.toLowerCase().includes(query),
        );
  });
  const [menuState, { open, close, highlight, move }] = createStateMachine(
    {
      context: { highlightedIndex: 0 },
      mode: "closed" as "closed" | "open",
    },
    {
      open(state) {
        if (props.disabled || props.options.length === 0) return;
        setSearch("");
        state.context.highlightedIndex = Math.max(
          0,
          props.options.findIndex((option) => option.id === props.value),
        );
        state.mode = "open";
      },
      close(state) {
        state.mode = "closed";
      },
      highlight(state, index: number) {
        if (state.mode === "open") state.context.highlightedIndex = index;
      },
      move(state, direction: -1 | 1) {
        if (props.disabled || props.options.length === 0) {
          state.mode = "closed";
          return;
        }
        if (state.mode === "closed") {
          setSearch("");
          state.context.highlightedIndex = Math.max(
            0,
            props.options.findIndex((option) => option.id === props.value),
          );
          state.mode = "open";
          return;
        }
        if (options().length === 0) return;
        state.context.highlightedIndex = Math.min(
          options().length - 1,
          Math.max(0, state.context.highlightedIndex + direction),
        );
      },
    },
  );
  const disabled = () => !!props.disabled || props.options.length === 0;
  const isOpen = () => menuState.mode === "open" && !disabled();
  const [menu, setMenu] = createSignal<HTMLDivElement | null>(null);
  const menuPresence = createPresence({
    show: isOpen,
    element: menu,
  });
  const selected = () => props.options.find((option) => option.id === props.value);
  const label = () => {
    const option = selected();
    if (option !== undefined) return option.name;
    if (props.options.length === 0) return props.unavailableLabel ?? props.placeholder;
    if (props.value !== "") return props.missingLabel ?? props.placeholder;
    return props.placeholder;
  };
  const selectHighlighted = () => {
    if (menuState.mode === "closed") return;
    const option = options()[menuState.context.highlightedIndex];
    if (option === undefined) return;
    props.onChange(option.id);
    close();
    trigger?.focus();
  };
  const position = () => {
    const bounds = trigger?.getBoundingClientRect();
    if (bounds === undefined) return {};
    const width = Math.min(innerWidth - 16, Math.max(bounds.width, props.menuMinWidth ?? 0));
    const height = Math.min(200, props.options.length * 24 + (searchable() ? 30 : 0) + 4);
    const top =
      bounds.bottom + 4 + height > innerHeight ? bounds.top - height - 4 : bounds.bottom + 4;
    return {
      left: `${Math.max(8, Math.min(bounds.left, innerWidth - width - 8))}px`,
      top: `${top}px`,
      width: `${width}px`,
    };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || disabled()) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && isOpen()) {
      event.preventDefault();
      selectHighlighted();
    } else if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      close();
      trigger?.focus();
    } else if (event.key === "Tab") {
      close();
    }
  };
  const toggle = () => (isOpen() ? close() : open());

  createEffect(
    () => ({ options: options(), search: search(), value: props.value }),
    ({ options, search, value }) => {
      highlight(
        search.trim()
          ? 0
          : Math.max(
              0,
              options.findIndex((option) => option.id === value),
            ),
      );
    },
  );
  createEffect(
    () => isOpen() && searchable() && menu(),
    (element) => {
      if (element) element.querySelector("input")?.focus({ preventScroll: true });
    },
  );
  createEffect(
    () => ({
      open: isOpen(),
      element: menu(),
      index: menuState.context.highlightedIndex,
      options: options(),
    }),
    ({ open, element, index }) => {
      if (!open) return;
      const list = element?.querySelector<HTMLElement>('[role="listbox"]');
      const option = list?.querySelectorAll<HTMLElement>('[role="option"]')[index];
      if (!list || !option) return;
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight)
        list.scrollTop = bottom - list.clientHeight;
    },
  );

  createEffect(
    () => props.options.length,
    (length) => {
      if (length === 0) close();
    },
  );

  createEffect(
    () => isOpen(),
    (open) => {
      props.onOpenChange?.(open);
    },
  );

  createEffect(
    () => true,
    () => {
      const closeOnOutsideClick = (event: PointerEvent) => {
        if (isOpen() && !root?.contains(event.target as globalThis.Node)) {
          close();
        }
      };
      const closeOnOutsideScroll = (event: Event) => {
        if (event.target instanceof globalThis.Node && menu()?.contains(event.target)) return;
        close();
      };
      window.addEventListener("pointerdown", closeOnOutsideClick);
      window.addEventListener("resize", close);
      window.addEventListener("scroll", closeOnOutsideScroll, true);
      return () => {
        window.removeEventListener("pointerdown", closeOnOutsideClick);
        window.removeEventListener("resize", close);
        window.removeEventListener("scroll", closeOnOutsideScroll, true);
      };
    },
  );

  return (
    <span ref={root} sx={styles.root} onKeyDown={onKeyDown}>
      <Show
        when={props.trigger}
        fallback={
          <button
            ref={trigger}
            type="button"
            disabled={disabled()}
            sx={[
              styles.focus,
              styles.trigger,
              props.appearance,
              props.valid ? styles.valid : styles.invalid,
            ]}
            aria-haspopup="listbox"
            aria-expanded={isOpen() ? "true" : "false"}
            onClick={toggle}
          >
            <span sx={[styles.label, selected() ? null : styles.placeholder]}>{label()}</span>
            <svg
              sx={[
                styles.chevron,
                isOpen() ? styles.rotated : null,
                disabled() ? styles.disabled : null,
              ]}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              aria-hidden="true"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        }
      >
        {(render) =>
          render()({
            ref: (element) => {
              trigger = element;
            },
            isOpen,
            disabled,
            toggle,
          })
        }
      </Show>
      <Show when={menuPresence.present()}>
        <div
          ref={setMenu}
          sx={[
            styles.menu,
            props.appearance,
            menuPresence.state() === "hiding" ? styles.hiding : styles.showing,
          ]}
          style={position()}
        >
          <Show when={searchable()}>
            <div sx={[searchMarker, styles.search]}>
              <IconTablerSearch aria-hidden="true" {...stylex.attrs(styles.searchIcon)} />
              <input
                type="text"
                aria-label="Search options"
                placeholder="Search..."
                autocomplete="off"
                spellcheck={false}
                sx={styles.searchInput}
                value={search()}
                onInput={(event) => setSearch(event.currentTarget.value)}
              />
              <Show when={search()}>
                <button
                  type="button"
                  sx={styles.searchClear}
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <IconBiX aria-hidden="true" {...stylex.attrs(styles.searchClearIcon)} />
                </button>
              </Show>
            </div>
          </Show>
          <div role="listbox" sx={styles.options}>
            <For each={options()}>
              {(option, index) => (
                <>
                  <Show when={option.group && options()[index() - 1]?.group !== option.group}>
                    <div role="presentation" sx={styles.group}>
                      {option.group}
                    </div>
                  </Show>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.id === props.value ? "true" : "false"}
                    sx={[
                      styles.option,
                      props.appearance,
                      menuState.context.highlightedIndex === index() ? styles.highlighted : null,
                    ]}
                    onPointerEnter={() => highlight(index())}
                    onClick={() => {
                      props.onChange(option.id);
                      close();
                      trigger?.focus();
                    }}
                  >
                    {option.name}
                  </button>
                </>
              )}
            </For>
          </div>
          <Show when={options().length === 0}>
            <div role="status" sx={styles.empty}>
              No matching options
            </div>
          </Show>
        </div>
      </Show>
    </span>
  );
}
