import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, Show } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Avatar } from "./Avatar.tsx";

export interface AccountMenuProps {
  readonly email: string;
  readonly onCredentials?: () => void;
  readonly onSignOut: () => void;
}

export function AccountMenu(props: AccountMenuProps) {
  const label = createMemo(() => props.email.split("@", 1)[0] ?? "");
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let firstAction: HTMLButtonElement | undefined;

  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    firstAction?.focus();
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof globalThis.Node && !root?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger?.focus();
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  });

  return (
    <div
      ref={root}
      sx={styles.root}
      onFocusOut={(event) => {
        if (
          !(event.relatedTarget instanceof globalThis.Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        sx={[styles.button, styles.trigger]}
        aria-label={`${label() || "Account"} options`}
        aria-expanded={open() ? "true" : "false"}
        aria-controls="account-popover"
        onClick={() => setOpen((value) => !value)}
      >
        <span sx={styles.name}>{label()}</span>
        <Avatar email={props.email} />
      </button>
      <Show when={open()}>
        <div id="account-popover" role="region" aria-label="Account actions" sx={styles.popover}>
          <Show when={props.onCredentials !== undefined}>
            <button
              ref={firstAction}
              type="button"
              sx={[styles.button, styles.action]}
              onClick={() => {
                setOpen(false);
                props.onCredentials?.();
              }}
            >
              Credentials
            </button>
          </Show>
          <button
            ref={(element) => {
              if (props.onCredentials === undefined) firstAction = element;
            }}
            type="button"
            sx={[styles.button, styles.logout]}
            onClick={() => {
              setOpen(false);
              props.onSignOut();
            }}
          >
            Log out
          </button>
        </div>
      </Show>
    </div>
  );
}

const styles = stylex.create({
  root: { position: "relative", minWidth: 0 },
  trigger: {
    display: "flex",
    minWidth: 0,
    minHeight: 32,
    alignItems: "center",
    gap: 8,
    padding: "4px 6px",
  },
  name: {
    display: "block",
    minWidth: 0,
    maxWidth: {
      default: 96,
      "@media (min-width: 640px)": 160,
      "@media (min-width: 1024px)": 192,
    },
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
    color: colors.gray10,
  },
  popover: {
    position: "absolute",
    zIndex: 50,
    top: "calc(100% + 6px)",
    right: 0,
    width: 160,
    padding: 4,
    borderRadius: 8,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray2,
    boxShadow: "0 12px 24px rgb(0 0 0 / .25)",
  },
  logout: { width: "100%", textAlign: "left" },
  action: { width: "100%", textAlign: "left" },
  button: {
    flexShrink: 0,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 12,
    fontWeight: 500,
    color: colors.gray11,
    backgroundColor: "transparent",
    "@media (hover: hover)": { ":hover": { color: colors.gray12, backgroundColor: colors.gray3 } },
  },
});
