import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";

import macrographLogo from "../macrograph-logo.png";
import { colors } from "../tokens.stylex.ts";

export type WorkspaceView = "editor" | "events";

/**
 * A self-hosted server's header: the brand, the workspace tabs when `view` is given, and
 * `children` at the end.
 */
export function ServerHeader(props: {
  readonly view?: WorkspaceView;
  readonly onViewChange?: (view: WorkspaceView) => void;
  readonly children?: JSX.Element;
}) {
  return (
    <header sx={styles.header}>
      <div sx={styles.brand}>
        <img src={macrographLogo} alt="MacroGraph" sx={styles.logo} />
        <span sx={styles.title}>MacroGraph</span>
      </div>
      <Show when={props.view !== undefined}>
        <nav sx={styles.nav} aria-label="Workspace">
          <For each={["editor", "events"] as const}>
            {(tab) => (
              <button
                type="button"
                sx={[styles.navItem, props.view === tab ? styles.navActive : styles.navIdle]}
                aria-current={props.view === tab ? "page" : undefined}
                onClick={() => props.onViewChange?.(tab)}
              >
                {tab}
              </button>
            )}
          </For>
        </nav>
      </Show>
      <div sx={styles.end}>{props.children}</div>
    </header>
  );
}

const styles = stylex.create({
  header: {
    alignItems: "center",
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "grid",
    gridTemplateColumns: { default: "1fr auto", "@media (min-width: 600px)": "1fr auto 1fr" },
    flexShrink: 0,
    columnGap: 8,
    minHeight: 44,
    paddingInline: 12,
  },
  brand: { display: "flex", alignItems: "center", gap: 8, minHeight: 44 },
  logo: { borderRadius: 6, height: 28, width: 28 },
  title: { fontWeight: 600, letterSpacing: "-0.025em" },
  nav: {
    display: "flex",
    alignSelf: "stretch",
    justifySelf: "center",
    gridColumn: { default: "1 / -1", "@media (min-width: 600px)": "2" },
    gridRowStart: { default: 2, "@media (min-width: 600px)": 1 },
  },
  navItem: {
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    paddingBlock: 8,
    paddingInline: 16,
    fontSize: 12,
    fontWeight: 500,
    textTransform: "capitalize",
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    cursor: "pointer",
  },
  navActive: { borderBottomColor: colors.focus, color: colors.gray12 },
  navIdle: {
    borderBottomColor: "transparent",
    color: { default: colors.gray10, ":hover": colors.gray12 },
  },
  end: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    justifySelf: "end",
    gridRowStart: 1,
    gridColumnStart: -2,
    minWidth: 0,
  },
});
