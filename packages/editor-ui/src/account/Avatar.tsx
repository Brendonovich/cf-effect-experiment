import * as stylex from "@stylexjs/stylex";
import { createMemo, Loading } from "solid-js";

import { colors } from "../tokens.stylex.ts";

export interface AvatarProps {
  readonly email: string;
  readonly style?: stylex.StyleXStyles;
}

const gravatarUrl = async (email: string) => {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const url = new URL(`https://gravatar.com/avatar/${hash}`);
  url.searchParams.set("s", "80");
  url.searchParams.set("d", "initials");
  url.searchParams.set("name", normalized.split("@", 1)[0] ?? normalized);
  return url.href;
};

export function Avatar(props: AvatarProps) {
  const source = createMemo(() => gravatarUrl(props.email));
  const initial = () => props.email.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <span sx={[styles.root, props.style]}>
      <Loading fallback={initial()}>
        <img
          src={source()}
          alt=""
          style={{ height: "100%", "object-fit": "cover", width: "100%" }}
          referrerpolicy="no-referrer"
        />
      </Loading>
    </span>
  );
}

const styles = stylex.create({
  root: {
    alignItems: "center",
    backgroundColor: colors.gray4,
    borderRadius: "50%",
    color: colors.gray11,
    display: "inline-grid",
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 600,
    height: 24,
    justifyItems: "center",
    overflow: "hidden",
    width: 24,
  },
});
