import type { JSX } from "@solidjs/web";

import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { docsSections } from "../docs/navigation";

/**
 * Docs pages with their sidebar. On narrower screens the sidebar becomes a drawer, opened from a
 * bar that shows where you are.
 */
export function DocsShell(props: { readonly children?: JSX.Element }) {
  const location = useLocation();
  const current = (href: string) => location.pathname.replace(/\/$/, "") === href;
  const here = createMemo(() => {
    for (const section of docsSections) {
      const page = section.items.find((item) => current(item.href));
      if (page !== undefined) return { section: section.label, page: page.label };
    }
    return undefined;
  });
  const [open, setOpen] = createSignal(false);
  let drawer: HTMLDialogElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  createEffect(open, (isOpen) => {
    if (!isOpen || drawer === undefined || typeof drawer.showModal !== "function") return;
    drawer.showModal();
    return () => {
      drawer?.close();
      trigger?.focus();
    };
  });
  // Choosing a page closes the drawer.
  createEffect(
    () => location.pathname,
    () => {
      setOpen(false);
    },
  );
  const close = () => setOpen(false);

  return (
    <div sx={styles.shell}>
      <div sx={styles.bar}>
        <button
          ref={(element) => (trigger = element)}
          type="button"
          aria-label="Open navigation"
          aria-expanded={open() ? "true" : "false"}
          aria-controls="docs-drawer"
          onClick={() => setOpen(true)}
          sx={styles.menuButton}
        >
          <IconTablerMenu2 {...stylex.attrs(styles.menuIcon)} />
        </button>
        <Show when={here()} fallback={<span sx={styles.crumbCurrent}>Docs</span>}>
          {(place) => (
            <span sx={styles.crumbs}>
              <span sx={styles.crumbSection}>{place().section}</span>
              <IconTablerChevronRight {...stylex.attrs(styles.crumbIcon)} />
              <span sx={styles.crumbCurrent}>{place().page}</span>
            </span>
          )}
        </Show>
      </div>
      <aside sx={styles.sidebar}>
        <DocsNav current={current} />
      </aside>
      <dialog
        ref={(element) => (drawer = element)}
        id="docs-drawer"
        aria-label="Docs navigation"
        sx={styles.drawer}
        onClose={close}
        onClick={(event) => {
          // The drawer fills its body, so a click on the dialog itself is on the backdrop.
          if (event.target === event.currentTarget) close();
        }}
      >
        <Show when={open()}>
          <div sx={styles.drawerBody}>
            <DocsNav current={current} onClose={close} />
          </div>
        </Show>
      </dialog>
      <div sx={styles.content}>{props.children}</div>
    </div>
  );
}

function DocsNav(props: {
  readonly current: (href: string) => boolean;
  /** Shows a close button beside the first section, for the drawer. */
  readonly onClose?: () => void;
}) {
  return (
    <nav aria-label="Docs" sx={styles.nav}>
      <For each={docsSections}>
        {(section, index) => (
          <section>
            <div sx={styles.sectionHeader}>
              <h2 sx={styles.sectionLabel}>{section.label}</h2>
              <Show when={index() === 0 && props.onClose}>
                {(onClose) => (
                  <button
                    type="button"
                    aria-label="Close navigation"
                    onClick={() => onClose()()}
                    sx={styles.close}
                  >
                    esc
                  </button>
                )}
              </Show>
            </div>
            <ul sx={styles.items}>
              <For each={section.items}>
                {(item) => (
                  <li>
                    <a
                      href={item.href}
                      aria-current={props.current(item.href) ? "page" : undefined}
                      sx={[styles.item, props.current(item.href) && styles.activeItem]}
                    >
                      {item.label}
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </nav>
  );
}

const slideIn = stylex.keyframes({
  from: { transform: "translateX(-100%)" },
  to: { transform: "none" },
});

const md = "@media (min-width: 768px)";
// The sidebar collapses before guides go flat, so their interactive layouts keep room.
const wide = "@media (min-width: 1100px)";
const reducedMotion = "@media (prefers-reduced-motion: reduce)";
const styles = stylex.create({
  shell: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr)", [wide]: "200px minmax(0, 1fr)" },
    alignItems: "start",
    width: "100%",
    maxWidth: 1360,
    boxSizing: "border-box",
    marginInline: "auto",
    paddingInline: { default: 12, [md]: 24 },
  },
  bar: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    display: { default: "flex", [wide]: "none" },
    alignItems: "center",
    gap: 12,
    gridColumn: "1 / -1",
    // Bleeds to the page edge, matching the shell's padding.
    marginInline: { default: -12, [md]: -24 },
    paddingInline: { default: 12, [md]: 24 },
    paddingBlock: 8,
    backgroundColor: colors.gray1,
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  menuButton: {
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    marginInlineStart: -6,
    padding: 0,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    color: { default: colors.gray11, ":hover": colors.gray12 },
    cursor: "pointer",
  },
  menuIcon: { width: 20, height: 20 },
  crumbs: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 13 },
  crumbSection: { flexShrink: 0, color: colors.gray10 },
  crumbIcon: { flexShrink: 0, width: 14, height: 14, color: colors.gray9 },
  crumbCurrent: {
    minWidth: 0,
    overflow: "hidden",
    color: colors.gray12,
    fontSize: 13,
    fontWeight: 500,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sidebar: {
    position: "sticky",
    top: 0,
    display: { default: "none", [wide]: "block" },
    maxHeight: "100dvh",
    boxSizing: "border-box",
    overflowY: "auto",
    paddingBlock: 32,
    paddingInlineEnd: 16,
  },
  drawer: {
    width: "min(320px, 85vw)",
    maxWidth: "none",
    height: "100dvh",
    maxHeight: "none",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRightColor: colors.gray4,
    borderRightStyle: "solid",
    borderRightWidth: 1,
    backgroundColor: colors.gray1,
    color: colors.gray12,
    animationName: slideIn,
    animationDuration: { default: "200ms", [reducedMotion]: "1ms" },
    animationTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    "::backdrop": { backgroundColor: "rgb(0 0 0 / 0.6)" },
  },
  drawerBody: {
    height: "100%",
    boxSizing: "border-box",
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingBlock: 24,
    paddingInline: 20,
  },
  nav: { display: "flex", flexDirection: "column", gap: 28 },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 24,
  },
  sectionLabel: {
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: colors.gray10,
  },
  close: {
    height: 24,
    paddingInline: 8,
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: "transparent",
    color: { default: colors.gray10, ":hover": colors.gray12 },
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    cursor: "pointer",
  },
  // A rule down the left of each list, which the current page brightens.
  items: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    marginTop: 10,
    padding: 0,
    listStyle: "none",
    borderLeftColor: colors.gray4,
    borderLeftStyle: "solid",
    borderLeftWidth: 1,
  },
  item: {
    display: "block",
    marginLeft: -1,
    paddingBlock: 6,
    paddingInlineStart: 14,
    borderLeftColor: { default: "transparent", ":hover": colors.gray7 },
    borderLeftStyle: "solid",
    borderLeftWidth: 1,
    fontSize: 13,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    textDecoration: "none",
  },
  activeItem: {
    borderLeftColor: { default: colors.gray12, ":hover": colors.gray12 },
    color: colors.gray12,
    fontWeight: 600,
  },
  content: { minWidth: 0, paddingInlineStart: { default: 0, [wide]: 32 } },
});
