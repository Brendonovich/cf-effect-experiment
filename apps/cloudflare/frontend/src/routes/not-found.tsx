import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({
  root: {
    display: "grid",
    height: "100%",
    placeItems: "center",
    backgroundColor: colors.gray2,
    color: colors.gray11,
  },
});

export const NotFoundRoute = () => <div sx={styles.root}>Route not found</div>;
