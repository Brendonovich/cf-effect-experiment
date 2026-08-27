import { Portal } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  untrack,
} from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { createPresence } from "./createPresence";

const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});
const exit = stylex.keyframes({
  from: { opacity: 1, transform: "translateY(0)" },
  to: { opacity: 0, transform: "translateY(-4px)" },
});
const styles = stylex.create({
  input: {
    width: 64,
    minWidth: 0,
    height: 20,
    borderColor: { default: "rgb(255 255 255 / 0.15)", ":focus": colors.focus },
    borderRadius: 4,
    borderStyle: "solid",
    borderWidth: 1,
    outline: "none",
    backgroundColor: "rgb(255 255 255 / 0.1)",
    paddingInline: 4,
    fontSize: 10,
    color: "white",
  },
  menu: {
    position: "fixed",
    zIndex: 50,
    boxSizing: "border-box",
    overflowY: "auto",
    overscrollBehavior: "contain",
    borderRadius: 4,
    backgroundColor: "#404040",
    padding: 4,
    color: "white",
    fontSize: 12,
  },
  showing: {
    animationName: enter,
    animationDuration: { default: "100ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
  },
  hiding: {
    animationName: exit,
    animationDuration: { default: "100ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
    pointerEvents: "none",
  },
  option: {
    display: "block",
    width: "100%",
    border: 0,
    borderRadius: 2,
    outline: "none",
    backgroundColor: { default: "transparent", ":hover": "#2563eb" },
    paddingBlock: 2,
    paddingInline: 4,
    color: "inherit",
    font: "inherit",
    lineHeight: "16px",
    textAlign: "left",
    overflowWrap: "anywhere",
  },
  highlighted: { backgroundColor: "#2563eb" },
});

export function TextInput(props: {
  value: string;
  label: string;
  onChange: (value: string) => void;
  onGetSuggestions?: (() => Promise<ReadonlyArray<string>>) | undefined;
}) {
  let input: HTMLInputElement | undefined;
  let dirty = false;
  const listId = createUniqueId();
  const [focused, setFocused] = createSignal(false);
  const [draft, setDraft] = createSignal(() =>
    focused() ? untrack(() => props.value) : props.value,
  );
  const [open, setOpen] = createSignal(false);
  const [filter, setFilter] = createSignal(false);
  const [suggestions, setSuggestions] = createSignal<ReadonlyArray<string>>([]);
  const options = createMemo(() =>
    filter()
      ? suggestions().filter((option) => option.toLowerCase().includes(draft().toLowerCase()))
      : suggestions(),
  );
  const [highlighted, setHighlighted] = createSignal(() => {
    options();
    return -1;
  });
  const shown = () => open() && options().length > 0;
  const [menu, setMenu] = createSignal<HTMLDivElement | null>(null);
  const presence = createPresence({ show: shown, element: menu });
  const [position, setPosition] = createSignal({ left: 0, top: 0, width: 208, maxHeight: 192 });
  const commit = () => {
    if (dirty && draft() !== props.value) props.onChange(draft());
    dirty = false;
  };
  const select = (option: string) => {
    dirty = false;
    setDraft(option);
    if (option !== props.value) props.onChange(option);
    setOpen(false);
    input?.blur();
  };

  createEffect(
    () => open() && props.onGetSuggestions,
    (fetch) => {
      if (!fetch) return;
      setSuggestions([]);
      let cancelled = false;
      void Promise.resolve()
        .then(fetch)
        .then(
          (values) => {
            if (!cancelled) setSuggestions(values);
          },
          () => {
            if (!cancelled) setSuggestions([]);
          },
        );
      return () => {
        cancelled = true;
      };
    },
  );
  createEffect(
    () => ({ shown: shown(), menu: menu(), count: options().length }),
    ({ shown, menu, count }) => {
      if (!shown) return;
      let frame = 0;
      const update = () => {
        if (!input) return;
        const bounds = input.getBoundingClientRect();
        const viewport = window.visualViewport;
        const x = viewport?.offsetLeft ?? 0;
        const y = viewport?.offsetTop ?? 0;
        const width = Math.min(208, (viewport?.width ?? window.innerWidth) - 16);
        const bottom = y + (viewport?.height ?? window.innerHeight) - 8;
        const below = Math.max(0, bottom - bounds.bottom - 4);
        const above = Math.max(0, bounds.top - y - 12);
        const height = Math.min(192, menu?.scrollHeight || count * 20 + 8);
        const flip = below < height && above > below;
        const maxHeight = Math.min(192, flip ? above : below);
        const next = {
          left: Math.max(
            x + 8,
            Math.min(bounds.left, x + (viewport?.width ?? window.innerWidth) - width - 8),
          ),
          top: flip
            ? Math.max(y + 8, bounds.top - Math.min(height, maxHeight) - 4)
            : bounds.bottom + 4,
          width,
          maxHeight,
        };
        setPosition((previous) =>
          previous.left === next.left &&
          previous.top === next.top &&
          previous.width === next.width &&
          previous.maxHeight === next.maxHeight
            ? previous
            : next,
        );
        // Canvas transforms do not emit scroll or resize events.
        frame = requestAnimationFrame(update);
      };
      update();
      return () => cancelAnimationFrame(frame);
    },
  );
  createEffect(
    () => ({ open: open(), menu: menu() }),
    ({ open, menu }) => {
      if (!open) return;
      const outside = (event: PointerEvent) => {
        if (
          event.target instanceof globalThis.Node &&
          event.target !== input &&
          !menu?.contains(event.target)
        ) {
          setOpen(false);
          input?.blur();
        }
      };
      window.addEventListener("pointerdown", outside, true);
      return () => window.removeEventListener("pointerdown", outside, true);
    },
  );
  createEffect(
    () => ({ index: highlighted(), menu: menu() }),
    ({ index, menu }) => {
      menu?.children[index]?.scrollIntoView({ block: "nearest" });
    },
  );

  return (
    <>
      <input
        ref={input}
        sx={styles.input}
        type="text"
        aria-label={props.label}
        role={props.onGetSuggestions ? "combobox" : undefined}
        aria-autocomplete={props.onGetSuggestions ? "list" : undefined}
        aria-expanded={props.onGetSuggestions ? (shown() ? "true" : "false") : undefined}
        aria-controls={shown() ? listId : undefined}
        aria-activedescendant={
          shown() && highlighted() >= 0 ? `${listId}-${highlighted()}` : undefined
        }
        autocomplete="off"
        value={draft()}
        onFocus={() => {
          setFocused(true);
          setFilter(false);
          setOpen(true);
        }}
        onInput={(event) => {
          dirty = true;
          setDraft(event.currentTarget.value);
          setFilter(true);
          setOpen(true);
        }}
        onBlur={() => {
          commit();
          setFocused(false);
          setOpen(false);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const option = shown() ? options()[highlighted()] : undefined;
            if (option !== undefined) select(option);
            else {
              commit();
              input?.blur();
            }
          } else if (
            props.onGetSuggestions &&
            (event.key === "ArrowDown" || event.key === "ArrowUp")
          ) {
            event.preventDefault();
            setOpen(true);
            setHighlighted((index) =>
              Math.max(
                0,
                Math.min(
                  options().length - 1,
                  index < 0
                    ? event.key === "ArrowDown"
                      ? 0
                      : options().length - 1
                    : index + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
        }}
      />
      <Show when={presence.present()}>
        <Portal>
          <div
            ref={setMenu}
            id={listId}
            role="listbox"
            aria-label={`${props.label} suggestions`}
            aria-hidden={shown() ? "false" : "true"}
            sx={[styles.menu, presence.state() === "hiding" ? styles.hiding : styles.showing]}
            style={{
              left: `${position().left}px`,
              top: `${position().top}px`,
              width: `${position().width}px`,
              "max-height": `${position().maxHeight}px`,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <For each={options()}>
              {(option, index) => (
                <button
                  type="button"
                  role="option"
                  tabindex={-1}
                  id={`${listId}-${index()}`}
                  aria-selected={highlighted() === index() ? "true" : "false"}
                  sx={[styles.option, highlighted() === index() && styles.highlighted]}
                  onPointerMove={(event) => {
                    if (event.pointerType === "mouse") setHighlighted(index());
                  }}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => select(option)}
                >
                  {option}
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}
