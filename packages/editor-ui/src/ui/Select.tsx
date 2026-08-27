import * as stylex from "@stylexjs/stylex";
import { For, Show, createEffect, createSignal } from "solid-js";

import { createPresence } from "./createPresence";
import { createStateMachine } from "./createStateMachine.ts";
import { colors } from "../tokens.stylex.ts";

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
    fontSize: 11,
    maxHeight: 200,
    overflowY: "auto",
    padding: 2,
    position: "fixed",
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

export function Select(props: {
  appearance?: stylex.StyleXStyles;
  options: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  value: string;
  valid: boolean;
  placeholder: string;
  unavailableLabel?: string;
  missingLabel?: string;
  onChange: (value: string) => void;
}) {
  let root: HTMLSpanElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const [menuState, { open, close, highlight, move }] = createStateMachine(
    {
      context: { highlightedIndex: 0 },
      mode: "closed" as "closed" | "open",
    },
    {
      open(state) {
        if (props.options.length === 0) return;
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
        if (props.options.length === 0) {
          state.mode = "closed";
          return;
        }
        if (state.mode === "closed") {
          state.context.highlightedIndex = Math.max(
            0,
            props.options.findIndex((option) => option.id === props.value),
          );
          state.mode = "open";
          return;
        }
        state.context.highlightedIndex = Math.min(
          props.options.length - 1,
          Math.max(0, state.context.highlightedIndex + direction),
        );
      },
    },
  );
  const isOpen = () => menuState.mode === "open" && props.options.length > 0;
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
    const option = props.options[menuState.context.highlightedIndex];
    if (option === undefined) return;
    props.onChange(option.id);
    close();
    trigger?.focus();
  };
  const position = () => {
    const bounds = trigger?.getBoundingClientRect();
    if (bounds === undefined) return {};
    const height = Math.min(200, props.options.length * 24 + 4);
    const top =
      bounds.bottom + 4 + height > innerHeight ? bounds.top - height - 4 : bounds.bottom + 4;
    return { left: `${bounds.left}px`, top: `${top}px`, width: `${bounds.width}px` };
  };

  createEffect(
    () => props.options.length,
    (length) => {
      if (length === 0) close();
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
      window.addEventListener("pointerdown", closeOnOutsideClick);
      window.addEventListener("resize", close);
      window.addEventListener("scroll", close, true);
      return () => {
        window.removeEventListener("pointerdown", closeOnOutsideClick);
        window.removeEventListener("resize", close);
        window.removeEventListener("scroll", close, true);
      };
    },
  );

  return (
    <span ref={root} sx={styles.root}>
      <button
        ref={trigger}
        type="button"
        disabled={props.options.length === 0}
        sx={[
          styles.focus,
          styles.trigger,
          props.appearance,
          props.valid ? styles.valid : styles.invalid,
        ]}
        aria-haspopup="listbox"
        aria-expanded={isOpen() ? "true" : "false"}
        onClick={() => (isOpen() ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            move(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Enter" && isOpen()) {
            event.preventDefault();
            selectHighlighted();
          } else if (event.key === "Escape" && isOpen()) {
            event.preventDefault();
            close();
          }
        }}
      >
        <span sx={[styles.label, selected() ? null : styles.placeholder]}>{label()}</span>
        <svg
          sx={[
            styles.chevron,
            isOpen() ? styles.rotated : null,
            props.options.length === 0 ? styles.disabled : null,
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
      <Show when={menuPresence.present()}>
        <div
          ref={setMenu}
          role="listbox"
          sx={[
            styles.menu,
            props.appearance,
            menuPresence.state() === "hiding" ? styles.hiding : styles.showing,
          ]}
          style={position()}
        >
          <For each={props.options}>
            {(option, index) => (
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
            )}
          </For>
        </div>
      </Show>
    </span>
  );
}
