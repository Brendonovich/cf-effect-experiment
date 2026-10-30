import { ButtonLink } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

import { Header } from "../Header";

export function NotFoundRoute() {
  return (
    <div sx={styles.page}>
      <Header />
      <main sx={styles.main}>
        <p sx={styles.code}>404</p>
        <h1 sx={styles.title}>Page not found</h1>
        <p sx={styles.description}>This page doesn't exist or is no longer available.</p>
        <ButtonLink href="/" variant="secondary" sx={styles.button}>
          Back to home
        </ButtonLink>
      </main>
    </div>
  );
}

const styles = stylex.create({
  page: { minHeight: "100dvh", backgroundColor: colors.gray1, color: colors.gray12 },
  main: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 120,
    paddingInline: 24,
    textAlign: "center",
  },
  code: {
    margin: 0,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    color: colors.gray9,
  },
  title: { margin: 0, marginTop: 8, fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" },
  description: { margin: 0, marginTop: 8, fontSize: 14, color: colors.gray10 },
  button: { marginTop: 24, borderRadius: 8 },
});
