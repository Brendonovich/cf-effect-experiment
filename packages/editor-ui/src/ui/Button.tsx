import type { JSX } from "@solidjs/web";
import type { StyleXStyles } from "@stylexjs/stylex";

import * as stylex from "@stylexjs/stylex";
import { omit } from "solid-js";

import { colors } from "../tokens.stylex.ts";

type ButtonSize = "sm" | "md";
type ButtonVariant = "primary" | "secondary" | "ghost" | "text" | "icon";

export interface ButtonProps {
  /** Controls sizing. `sm` is compact, `md` is the default size. */
  readonly size?: ButtonSize;
  /** Controls the color treatment. `primary` is the default white style. */
  readonly variant?: ButtonVariant;
  /** Additional StyleX styles applied after the shared button styles. */
  readonly sx?: StyleXStyles;
  readonly children?: JSX.Element;
}

const styles = stylex.create({
  base: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 2,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: {
      default: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      ":focus-visible": `inset 0 0 0 1px ${colors.focus}`,
    },
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    display: "inline-flex",
    flexShrink: 0,
    justifyContent: "center",
    opacity: { default: 1, ":disabled": 0.5 },
    outline: "none",
    pointerEvents: { default: "auto", ":disabled": "none" },
    transitionProperty: "background-color, filter",
  },
  active: {
    filter: { default: null, ":active": "brightness(0.9)" },
  },
  small: { fontSize: 12, fontWeight: 500, height: 24, paddingInline: 8 },
  medium: { fontSize: 12, fontWeight: 600, height: 32, paddingInline: 12 },
  primary: {
    backgroundColor: colors.gray12,
    color: colors.gray1,
    "@media (hover: hover)": { ":hover": { backgroundColor: colors.gray11 } },
  },
  secondary: {
    backgroundColor: colors.gray3,
    color: colors.gray12,
    "@media (hover: hover)": { ":hover": { backgroundColor: colors.gray4 } },
  },
  ghost: {
    backgroundColor: "transparent",
    boxShadow: "none",
    color: colors.gray12,
    "@media (hover: hover)": { ":hover": { backgroundColor: colors.gray3 } },
  },
  text: {
    backgroundColor: "transparent",
    boxShadow: "none",
    color: colors.gray11,
    "@media (hover: hover)": { ":hover": { color: colors.gray12 } },
  },
  icon: {
    aspectRatio: "1",
    backgroundColor: "transparent",
    boxShadow: {
      default: "none",
      ":focus-visible": `inset 0 0 0 1px ${colors.focus}`,
    },
    color: colors.gray10,
    paddingInline: 0,
    "@media (hover: hover)": { ":hover": { backgroundColor: colors.gray4, color: colors.gray12 } },
  },
});

const sizeStyle = { sm: styles.small, md: styles.medium };
const variantStyle = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  text: styles.text,
  icon: styles.icon,
};

function buttonAttrs(props: ButtonProps) {
  const attrs = stylex.attrs(
    styles.base,
    styles.active,
    sizeStyle[props.size ?? "md"],
    variantStyle[props.variant ?? "primary"],
    props.sx,
  );
  return attrs;
}

export function Button(props: ButtonProps & JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const native = omit(props, "size", "variant", "sx", "children");
  return (
    <button {...native} {...buttonAttrs(props)}>
      {props.children}
    </button>
  );
}

export interface ButtonLinkProps extends ButtonProps {
  readonly href: string;
}

export function ButtonLink(props: ButtonLinkProps & JSX.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const native = omit(props, "size", "variant", "sx", "children", "href");
  return (
    <a {...native} href={props.href} {...buttonAttrs(props)}>
      {props.children}
    </a>
  );
}
