import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";
import { omit } from "solid-js";

import { colors } from "../tokens.stylex.ts";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const styles = stylex.create({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    borderRadius: 9,
    borderStyle: "solid",
    borderWidth: 1,
    paddingInline: 6,
    fontSize: 10,
    fontWeight: 500,
    lineHeight: 1,
    whiteSpace: "nowrap",
  },
  neutral: { borderColor: colors.gray6, backgroundColor: colors.gray3, color: colors.gray11 },
  info: { borderColor: "#1f4f8f", backgroundColor: "#0f2442", color: "#9cc5ff" },
  success: { borderColor: "#2b6a3a", backgroundColor: "#11281a", color: "#8fd9a2" },
  warning: { borderColor: "#7a5a12", backgroundColor: "#2c2208", color: "#f1c862" },
  danger: { borderColor: colors.red7, backgroundColor: colors.red3, color: colors.red11 },
  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    margin: 0,
    borderRadius: 4,
    borderStyle: "solid",
    borderWidth: 1,
    paddingBlock: 6,
    paddingInline: 8,
    fontSize: 12,
    lineHeight: "18px",
  },
  noticeBody: { flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  input: {
    flex: 1,
    minWidth: 0,
    height: 24,
    boxSizing: "border-box",
    borderColor: colors.gray6,
    borderRadius: 2,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray1,
    color: colors.gray12,
    fontFamily: "inherit",
    fontSize: 12,
    paddingInline: 8,
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
});

export const tones = {
  neutral: styles.neutral,
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
};

export function Badge(props: {
  readonly tone?: Tone;
  readonly title?: string | undefined;
  readonly children: JSX.Element;
}) {
  return (
    <span sx={[styles.badge, tones[props.tone ?? "neutral"]]} title={props.title}>
      {props.children}
    </span>
  );
}

export function Notice(props: {
  readonly tone: Tone;
  readonly role?: "alert" | "status";
  readonly children: JSX.Element;
  readonly action?: JSX.Element;
}) {
  return (
    <div sx={[styles.notice, tones[props.tone]]} role={props.role}>
      <div sx={styles.noticeBody}>{props.children}</div>
      {props.action}
    </div>
  );
}

export function TextField(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const native = omit(props, "class");
  return <input {...native} {...stylex.attrs(styles.input)} />;
}
