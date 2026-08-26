import type { Component } from "solid-js";

import * as stylex from "@stylexjs/stylex";

import { colors } from "../tokens.stylex.ts";

interface LoadingStateProps {
  readonly label: string;
  readonly style?: stylex.StyleXStyles;
  readonly compact?: boolean;
}

const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });
const styles = stylex.create({
  root: { display: "grid", placeItems: "center" },
  content: { display: "flex", flexDirection: "column", gap: 8, maxWidth: 128, width: "100%" },
  bar: {
    animationDuration: "2s",
    animationIterationCount: "infinite",
    animationName: pulse,
    borderRadius: 4,
    height: 8,
    width: "100%",
  },
  primary: { backgroundColor: colors.gray5 },
  secondary: { backgroundColor: colors.gray4, width: "66.666667%" },
});

export const LoadingState: Component<LoadingStateProps> = (props) => {
  return (
    <div sx={[styles.root, props.style]} role="status" aria-label={props.label}>
      <div sx={styles.content}>
        <span sx={[styles.bar, styles.primary]} />
        {props.compact ? null : <span sx={[styles.bar, styles.secondary]} />}
      </div>
    </div>
  );
};
