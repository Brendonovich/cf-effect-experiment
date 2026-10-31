import type { JSX } from "@solidjs/web";

import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";

import { packageCounts, packageLogo, packagePath, packages } from "../docs/reference";
import { Header } from "../Header";

export function DocsLayout(props: { readonly children?: JSX.Element }) {
  return (
    <div sx={styles.page}>
      <Header />
      {props.children}
    </div>
  );
}

export function DocsIndexRoute() {
  return (
    <main sx={styles.main}>
      <h1 sx={styles.title}>Package reference</h1>
      <p sx={styles.lead}>
        Each package adds nodes to MacroGraph for a program, service, or kind of data. Pick one to
        browse its nodes, try their properties, and copy them into your graphs.
      </p>
      <ul sx={styles.grid}>
        <For each={packages}>
          {(pkg) => (
            <li sx={styles.card}>
              <Show
                when={packageLogo(pkg)}
                fallback={
                  <span sx={[styles.cardLogo, styles.logoFallback]}>{pkg.displayName[0]}</span>
                }
              >
                {(logo) => <img src={logo()} alt="" sx={styles.cardLogo} />}
              </Show>
              <div sx={styles.cardBody}>
                <h2 sx={styles.cardTitle}>
                  <a href={packagePath(pkg)} sx={styles.cardLink}>
                    {pkg.displayName}
                  </a>
                </h2>
                <p sx={styles.cardId}>
                  {pkg.publisher}/{pkg.name}
                </p>
                <Show when={pkg.description}>
                  {(description) => <p sx={styles.cardDescription}>{description()}</p>}
                </Show>
                <p sx={styles.cardMeta}>{packageCounts(pkg)}</p>
              </div>
            </li>
          )}
        </For>
      </ul>
    </main>
  );
}

const md = "@media (min-width: 768px)";
const styles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100dvh",
    backgroundColor: colors.gray1,
    color: colors.gray12,
  },
  main: {
    width: "100%",
    maxWidth: 1080,
    boxSizing: "border-box",
    marginInline: "auto",
    paddingInline: { default: 12, [md]: 24 },
    paddingTop: { default: 20, [md]: 56 },
    paddingBottom: { default: 48, [md]: 96 },
  },
  title: {
    margin: 0,
    fontSize: { default: 24, [md]: 32 },
    fontWeight: 700,
    letterSpacing: "-0.025em",
  },
  lead: {
    margin: 0,
    marginTop: { default: 8, [md]: 12 },
    maxWidth: 640,
    fontSize: { default: 14, [md]: 15 },
    lineHeight: { default: "22px", [md]: "24px" },
    color: colors.gray11,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))",
    gap: { default: 8, [md]: 12 },
    marginTop: { default: 20, [md]: 32 },
    padding: 0,
    listStyle: "none",
  },
  card: {
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: { default: 12, [md]: 14 },
    padding: { default: 12, [md]: 16 },
    borderColor: { default: colors.gray5, ":hover": colors.gray7 },
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: colors.gray2,
    transitionProperty: "border-color",
    transitionDuration: "150ms",
  },
  cardLogo: {
    flexShrink: 0,
    width: 40,
    height: 40,
    borderRadius: 8,
    objectFit: "contain",
  },
  logoFallback: {
    display: "grid",
    placeItems: "center",
    backgroundColor: colors.gray4,
    color: colors.gray11,
    fontSize: 16,
    fontWeight: 600,
  },
  cardBody: { minWidth: 0 },
  cardTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  // The title's link covers the whole card.
  cardLink: {
    color: "inherit",
    textDecoration: "none",
    "::after": { content: '""', position: "absolute", inset: 0, borderRadius: 10 },
  },
  cardId: {
    margin: 0,
    marginTop: 2,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    color: colors.gray9,
  },
  cardDescription: {
    margin: 0,
    marginTop: 6,
    fontSize: 13,
    lineHeight: "20px",
    color: colors.gray11,
  },
  cardMeta: { margin: 0, marginTop: 6, fontSize: 12, color: colors.gray9 },
});
