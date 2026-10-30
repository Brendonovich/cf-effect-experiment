import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { For, Show, createEffect, createSignal } from "solid-js";

const targets = [
  { target: "windows-x86_64", platform: "Windows", variant: undefined },
  { target: "darwin-aarch64", platform: "macOS", variant: "Apple Silicon" },
  { target: "darwin-x86_64", platform: "macOS", variant: "Intel" },
  { target: "linux-x86_64-AppImage", platform: "Linux", variant: "AppImage" },
  { target: "linux-x86_64-deb", platform: "Linux", variant: "deb" },
] as const;

export function DownloadMenu() {
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | undefined;

  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof globalThis.Node && !root?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  });

  return (
    <div ref={(element) => (root = element)} sx={styles.root}>
      <Button
        type="button"
        sx={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        aria-controls="download-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <IconTablerDeviceDesktopDown {...stylex.attrs(styles.icon)} />
        Download
        <IconTablerChevronDown {...stylex.attrs(styles.icon, open() && styles.chevronOpen)} />
      </Button>
      <Show when={open()}>
        <div id="download-menu" role="menu" sx={styles.menu}>
          <For each={targets}>
            {(item) => (
              <a
                role="menuitem"
                href={`/api/desktop/download/latest/${item.target}`}
                sx={styles.item}
                onClick={() => setOpen(false)}
              >
                {item.platform}
                {item.variant === undefined ? null : <span sx={styles.badge}>{item.variant}</span>}
              </a>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

const styles = stylex.create({
  root: { position: "relative" },
  trigger: { gap: 8, height: 44, paddingInline: 20, borderRadius: 8, fontSize: 15 },
  icon: { width: 18, height: 18 },
  chevronOpen: { transform: "rotate(180deg)" },
  menu: {
    position: "absolute",
    top: "calc(100% + 8px)",
    left: "50%",
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    minWidth: 220,
    padding: 4,
    transform: "translateX(-50%)",
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray2,
    boxShadow: "0 12px 32px rgb(0 0 0 / 0.4)",
  },
  item: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingBlock: 8,
    paddingInline: 10,
    borderRadius: 6,
    fontSize: 14,
    color: colors.gray12,
    textAlign: "left",
    textDecoration: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.gray4,
      ":focus-visible": colors.gray4,
    },
    outline: "none",
  },
  badge: {
    paddingInline: 6,
    borderRadius: 4,
    backgroundColor: colors.gray4,
    fontSize: 11,
    lineHeight: "18px",
    color: colors.gray11,
  },
});
