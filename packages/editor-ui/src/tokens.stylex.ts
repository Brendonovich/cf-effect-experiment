import * as stylex from "@stylexjs/stylex";

declare module "@solidjs/web/jsx-runtime" {
  namespace JSX {
    interface HTMLAttributes<T> {
      sx?: stylex.StyleXArray<
        | stylex.CompiledStyles
        | boolean
        | null
        | undefined
        | readonly [stylex.CompiledStyles, stylex.InlineStyles]
      >;
    }

    interface SVGAttributes<T> {
      sx?: stylex.StyleXArray<
        | stylex.CompiledStyles
        | boolean
        | null
        | undefined
        | readonly [stylex.CompiledStyles, stylex.InlineStyles]
      >;
    }
  }
}

export const colors = stylex.defineVars({
  gray1: "var(--gray-1)",
  gray2: "var(--gray-2)",
  gray3: "var(--gray-3)",
  gray4: "var(--gray-4)",
  gray5: "var(--gray-5)",
  gray6: "var(--gray-6)",
  gray7: "var(--gray-7)",
  gray8: "var(--gray-8)",
  gray9: "var(--gray-9)",
  gray10: "var(--gray-10)",
  gray11: "var(--gray-11)",
  gray12: "var(--gray-12)",
  red1: "var(--red-1)",
  red2: "var(--red-2)",
  red3: "var(--red-3)",
  red4: "var(--red-4)",
  red5: "var(--red-5)",
  red6: "var(--red-6)",
  red7: "var(--red-7)",
  red8: "var(--red-8)",
  red9: "var(--red-9)",
  red10: "var(--red-10)",
  red11: "var(--red-11)",
  red12: "var(--red-12)",
  event: "#c20000",
  execution: "#2163eb",
  pure: "#008e62",
  base: "#696969",
  focus: "#eab308",
});
