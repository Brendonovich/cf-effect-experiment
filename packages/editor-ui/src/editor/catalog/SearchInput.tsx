import * as stylex from "@stylexjs/stylex";

import { colors } from "../../tokens.stylex.ts";
import { searchMarker } from "../markers.stylex.ts";

const styles = stylex.create({
  root: { alignItems: "stretch", display: "flex", flex: 1, flexDirection: "row", minWidth: 0 },
  icon: {
    color: {
      default: colors.gray9,
      [stylex.when.ancestor(":focus-within", searchMarker)]: colors.focus,
    },
    flexShrink: 0,
    height: 14,
    marginBlock: "auto",
    marginLeft: 8,
    width: 14,
  },
  input: {
    backgroundColor: "transparent",
    flex: 1,
    fontSize: 12,
    height: "100%",
    minWidth: 0,
    outline: "none",
    paddingInline: 6,
    "::placeholder": { color: colors.gray9 },
  },
});

export function SearchInput(props: {
  value: string;
  placeholder: string;
  label?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div sx={[searchMarker, styles.root]}>
      <IconTablerSearch aria-hidden="true" {...stylex.attrs(styles.icon)} />
      <input
        type="search"
        sx={styles.input}
        aria-label={props.label ?? props.placeholder}
        placeholder={props.placeholder}
        value={props.value}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  );
}
