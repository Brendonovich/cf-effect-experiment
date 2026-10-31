import type { JSX } from "@solidjs/web";

import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";

import { docsSections } from "../docs/navigation";
import { modulesPath } from "../docs/reference";
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
      <h1 sx={styles.title}>Docs</h1>
      <p sx={styles.lead}>
        Guides for getting MacroGraph running and making the most of it. Looking for what a node
        does? Browse the{" "}
        <a href={modulesPath} sx={styles.link}>
          modules
        </a>
        .
      </p>
      <For each={docsSections}>
        {(section) => (
          <section sx={styles.section}>
            <h2 sx={styles.sectionTitle}>{section.label}</h2>
            <ul sx={styles.grid}>
              <For each={section.items}>
                {(page) => (
                  <li sx={styles.card}>
                    <h3 sx={styles.cardTitle}>
                      <a href={page.href} sx={styles.cardLink}>
                        {page.label}
                      </a>
                    </h3>
                    <p sx={styles.cardDescription}>{page.description}</p>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </main>
  );
}

const md = "@media (min-width: 768px)";
const styles = stylex.create({
  page: { minHeight: "100dvh", backgroundColor: colors.gray1, color: colors.gray12 },
  // The docs shell sets the page's width and side padding.
  main: {
    maxWidth: 1080,
    paddingTop: { default: 20, [md]: 40 },
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
  link: { color: colors.gray12, textDecoration: "underline", textUnderlineOffset: 3 },
  section: { marginTop: { default: 24, [md]: 40 } },
  sectionTitle: {
    margin: 0,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: colors.gray9,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))",
    gap: { default: 8, [md]: 12 },
    marginTop: 12,
    padding: 0,
    listStyle: "none",
  },
  card: {
    position: "relative",
    padding: { default: 12, [md]: 16 },
    borderColor: { default: colors.gray5, ":hover": colors.gray7 },
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: colors.gray2,
    transitionProperty: "border-color",
    transitionDuration: "150ms",
  },
  cardTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  // The title's link covers the whole card.
  cardLink: {
    color: "inherit",
    textDecoration: "none",
    "::after": { content: '""', position: "absolute", inset: 0, borderRadius: 10 },
  },
  cardDescription: {
    margin: 0,
    marginTop: 6,
    fontSize: 13,
    lineHeight: "20px",
    color: colors.gray11,
  },
});
