import { Portal } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createSignal, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";

const menuEnter = stylex.keyframes({
  from: { opacity: 0, transform: "scale(.96)" },
  to: { opacity: 1, transform: "scale(1)" },
});

const styles = stylex.create({
  focus: {
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  row: { display: "flex", alignItems: "center", minWidth: 0 },
  selected: {
    backgroundColor: { default: colors.gray4, ":hover": colors.gray5 },
    boxShadow: `inset -2px 0 0 ${colors.focus}`,
  },
  unselected: { backgroundColor: { default: "transparent", ":hover": colors.gray4 } },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    paddingBlock: 5,
    paddingInline: 8,
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  icon: { width: 15, height: 15, flexShrink: 0 },
  input: {
    backgroundColor: colors.gray2,
    color: colors.gray12,
    fontSize: 12,
    outline: "none",
    boxShadow: `inset 0 0 0 1px ${colors.focus}`,
    borderRadius: 3,
    height: 26,
    marginInline: 4,
    paddingInline: 4,
    flex: 1,
    minWidth: 0,
  },
  menu: {
    animationName: {
      default: menuEnter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "140ms",
    animationTimingFunction: "cubic-bezier(.16, 1, .3, 1)",
    animationFillMode: "both",
    transformOrigin: "top left",
    position: "fixed",
    zIndex: 100,
    backgroundColor: colors.gray2,
    color: colors.gray12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.gray6,
    boxShadow: "0 12px 32px rgb(0 0 0 / .35), 0 2px 6px rgb(0 0 0 / .2)",
    padding: 4,
    borderRadius: 6,
    overflowY: "auto",
    maxHeight: "calc(100dvh - 16px)",
  },
  header: {
    fontSize: 11,
    fontWeight: 600,
    padding: 8,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.gray6,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  action: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    borderRadius: 4,
    paddingBlock: 4,
    paddingInline: 8,
    fontSize: 12,
    textAlign: "left",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.gray5,
      ":focus-visible": colors.gray5,
    },
    outline: "none",
    "@media (pointer: coarse)": { minHeight: 40 },
  },
  divider: { height: 1, backgroundColor: colors.gray6, marginBlock: 3, marginInline: 4 },
  danger: {
    color: colors.red11,
    backgroundColor: {
      default: "transparent",
      ":hover": colors.red3,
      ":focus-visible": colors.red3,
    },
  },
  confirmText: { fontSize: 11, color: colors.gray11, padding: 8, lineHeight: 1.5 },
});

export function GraphNavigationOption(props: {
  name: string;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  let row: HTMLDivElement | undefined;
  let nameButton: HTMLButtonElement | undefined;
  let menuElement: HTMLDivElement | undefined;
  let returnFocus: HTMLElement | undefined;

  const close = (restoreFocus = false) => {
    setMenu(null);
    setConfirming(false);
    if (restoreFocus) returnFocus?.focus();
  };
  const open = (trigger: HTMLElement, point?: { x: number; y: number }) => {
    if (!props.canEdit) return;
    const bounds = row?.getBoundingClientRect();
    returnFocus = trigger;
    setConfirming(false);
    setMenu(
      point ?? {
        x: bounds?.left ?? 8,
        y: (bounds?.bottom ?? 8) + 4,
      },
    );
  };
  const position = () => {
    const point = menu();
    const width = Math.min(176, window.innerWidth - 16);
    const height = confirming() ? 220 : 100;
    return {
      width: `${width}px`,
      left: `${Math.max(8, Math.min(point?.x ?? 8, window.innerWidth - width - 8))}px`,
      top: `${Math.max(8, Math.min(point?.y ?? 8, window.innerHeight - height - 8))}px`,
    };
  };
  const finishRename = (value: string, restoreFocus = false) => {
    if (!editing()) return;
    setEditing(false);
    if (value.trim() && value.trim() !== props.name) props.onRename(value.trim());
    if (restoreFocus) queueMicrotask(() => nameButton?.focus());
  };

  createEffect(
    () => props.canEdit,
    (canEdit) => {
      if (canEdit) return;
      close();
      setEditing(false);
    },
  );
  createEffect(
    () => menu() !== null,
    (isOpen) => {
      if (!isOpen) return;
      const outside = (event: PointerEvent) => {
        if (
          event.target instanceof globalThis.Node &&
          !menuElement?.contains(event.target) &&
          !row?.contains(event.target)
        )
          close();
      };
      const dismiss = () => close();
      const scroll = (event: Event) => {
        if (event.target instanceof globalThis.Node && menuElement?.contains(event.target)) return;
        close();
      };
      const escape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      };
      window.addEventListener("pointerdown", outside);
      window.addEventListener("resize", dismiss);
      window.addEventListener("scroll", scroll, true);
      window.addEventListener("keydown", escape, true);
      return () => {
        window.removeEventListener("pointerdown", outside);
        window.removeEventListener("resize", dismiss);
        window.removeEventListener("scroll", scroll, true);
        window.removeEventListener("keydown", escape, true);
      };
    },
  );
  createEffect(
    () => [menu(), confirming()] as const,
    ([point]) => {
      if (point)
        queueMicrotask(() => menuElement?.querySelector<HTMLButtonElement>("button")?.focus());
    },
  );

  return (
    <div
      ref={row}
      sx={[styles.row, props.selected ? styles.selected : styles.unselected]}
      onContextMenu={(event) => {
        if (!props.canEdit || editing()) return;
        event.preventDefault();
        open(nameButton ?? event.currentTarget, { x: event.clientX, y: event.clientY });
      }}
    >
      <Show
        when={editing()}
        fallback={
          <button
            ref={nameButton}
            type="button"
            sx={[styles.focus, styles.name]}
            title={props.name}
            onClick={() => {
              close();
              props.onSelect();
            }}
            onKeyDown={(event) => {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                open(event.currentTarget);
              }
            }}
          >
            {props.name}
          </button>
        }
      >
        <input
          sx={styles.input}
          aria-label="Graph name"
          value={props.name}
          ref={(input) =>
            queueMicrotask(() => {
              input.focus();
              input.select();
            })
          }
          onBlur={(event) => finishRename(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              finishRename(event.currentTarget.value, true);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              queueMicrotask(() => nameButton?.focus());
            }
          }}
        />
      </Show>
      <Show when={menu()}>
        <Portal>
          <div
            ref={menuElement}
            role="menu"
            aria-label={`Actions for ${props.name}`}
            sx={styles.menu}
            style={position()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
              );
              const index = buttons.findIndex((button) => button === document.activeElement);
              if (
                ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(
                  event.key,
                )
              ) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) +
                          buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }
              if (event.key === "Tab") close(true);
            }}
          >
            <Show
              when={confirming()}
              fallback={
                <>
                  <button
                    type="button"
                    role="menuitem"
                    sx={[styles.focus, styles.action]}
                    onClick={() => {
                      close();
                      setEditing(true);
                    }}
                  >
                    <svg
                      sx={styles.icon}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m16 4 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" />
                    </svg>
                    <span>Rename</span>
                  </button>
                  <div role="separator" sx={styles.divider} />
                  <button
                    type="button"
                    role="menuitem"
                    sx={[styles.focus, styles.action, styles.danger]}
                    onClick={() => setConfirming(true)}
                  >
                    <svg
                      sx={styles.icon}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                    </svg>
                    <span>Delete</span>
                  </button>
                </>
              }
            >
              <div sx={styles.header} title={props.name}>
                Delete {props.name}?
              </div>
              <p sx={styles.confirmText}>
                This removes the graph and all its nodes. This cannot be undone.
              </p>
              <button
                type="button"
                role="menuitem"
                sx={[styles.focus, styles.action]}
                onClick={() => close(true)}
              >
                Cancel
              </button>
              <button
                type="button"
                role="menuitem"
                sx={[styles.focus, styles.action, styles.danger]}
                onClick={() => {
                  close(true);
                  props.onDelete();
                }}
              >
                Delete graph
              </button>
            </Show>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
