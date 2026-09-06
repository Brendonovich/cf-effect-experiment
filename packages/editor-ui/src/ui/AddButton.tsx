import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";

import { colors } from "../tokens.stylex.ts";
import { Button } from "./Button";

const styles = stylex.create({
  button: {
    alignSelf: "center",
    backgroundColor: { default: "transparent", ":hover": colors.gray6 },
    borderRadius: 4,
    borderWidth: 0,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    height: 20,
    marginBlock: "auto",
    marginInline: 6,
    padding: 2,
    width: 20,
  },
  icon: { flexShrink: 0, height: 16, width: 16 },
});

export function AddButton(props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <Button {...props} type="button" size="sm" variant="icon" sx={styles.button}>
      <IconBiPlus aria-hidden="true" {...stylex.attrs(styles.icon)} />
    </Button>
  );
}
