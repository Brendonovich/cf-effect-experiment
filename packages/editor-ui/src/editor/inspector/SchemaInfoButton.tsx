import type { Package } from "@macrograph/core";

import * as stylex from "@stylexjs/stylex";
import { Show, createSignal, onSettled } from "solid-js";

import { colors } from "../../tokens.stylex.ts";

const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateX(8px)" },
  to: { opacity: 1, transform: "translateX(0)" },
});
const exit = stylex.keyframes({
  from: { opacity: 1, transform: "translateX(0)" },
  to: { opacity: 0, transform: "translateX(8px)" },
});
const styles = stylex.create({
  trigger: {
    alignItems: "center",
    borderColor: colors.gray6,
    borderRadius: 6,
    borderStyle: "solid",
    borderWidth: 1,
    display: "flex",
    height: 40,
    overflow: "hidden",
    outline: "none",
    textAlign: "left",
    width: "100%",
    backgroundColor: {
      default: "transparent",
      ":hover": "color-mix(in srgb, var(--gray-12) 5%, transparent)",
    },
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  typeBar: { flexShrink: 0, height: "100%", width: 4 },
  event: { backgroundColor: "#b91c1c" },
  exec: { backgroundColor: "#2563eb" },
  pure: { backgroundColor: "#047857" },
  names: { flex: 1, minWidth: 0, paddingBlock: 4, paddingInline: 8 },
  schemaName: {
    color: colors.gray12,
    display: "block",
    fontSize: 12,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  packageName: {
    color: colors.gray11,
    display: "block",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dialog: {
    backgroundColor: colors.gray3,
    borderColor: colors.gray6,
    borderRadius: 4,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
    fontSize: 12,
    overflow: "hidden",
    position: "fixed",
    transformOrigin: "right",
    zIndex: 50,
  },
  showing: {
    animationDuration: { default: "150ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
    animationName: enter,
  },
  hiding: {
    animationDuration: { default: "100ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
    animationName: exit,
    pointerEvents: "none",
  },
  dialogTitle: { color: colors.gray12, fontWeight: 500, lineHeight: 1.25, padding: 4 },
  details: { display: "flex", flexDirection: "column", gap: 6, padding: 6 },
  detail: { display: "flex", flexDirection: "column", gap: 2 },
  detailLabel: { color: colors.gray11, fontSize: 11, fontWeight: 500 },
  detailValue: { color: colors.gray12, fontSize: 12 },
  actions: {
    borderTopColor: colors.gray5,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    display: "flex",
    height: 28,
    textAlign: "center",
  },
  action: {
    color: colors.gray11,
    flex: 1,
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  leftAction: { borderBottomLeftRadius: 4 },
  rightAction: {
    borderBottomRightRadius: 4,
    borderLeftColor: colors.gray5,
    borderLeftStyle: "solid",
    borderLeftWidth: 1,
    backgroundColor: {
      default: "transparent",
      ":hover": "color-mix(in srgb, var(--gray-12) 5%, transparent)",
    },
    color: { default: colors.gray11, ":hover": colors.gray12 },
  },
});

export function SchemaInfoButton(props: { schema: Package.SchemaModel; packageName: string }) {
  let root: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const [dialogState, setDialogState] = createSignal<"present" | "hiding" | "hidden">("hidden");
  const open = () => dialogState() === "present";
  const close = () => setDialogState((state) => (state === "present" ? "hiding" : state));
  const typeColor = () =>
    props.schema.type === "event"
      ? styles.event
      : props.schema.type === "exec"
        ? styles.exec
        : styles.pure;
  const popoutPosition = () => {
    const bounds = trigger?.getBoundingClientRect();
    const width = Math.min(208, innerWidth - 16);
    return {
      left: `${Math.max(8, (bounds?.left ?? 8) - width - 6)}px`,
      top: `${Math.max(8, Math.min(innerHeight - 96, bounds?.top ?? 8))}px`,
      width: `${width}px`,
    };
  };

  onSettled(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (open() && !root?.contains(event.target as globalThis.Node)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (open() && event.key === "Escape") {
        close();
        trigger?.focus();
      }
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  });

  return (
    <div ref={root}>
      <button
        ref={trigger}
        type="button"
        sx={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setDialogState((state) => (state === "present" ? "hiding" : "present"))}
      >
        <span sx={[styles.typeBar, typeColor()]} />
        <span sx={styles.names}>
          <span sx={styles.schemaName}>{props.schema.name}</span>
          <span sx={styles.packageName}>{props.packageName}</span>
        </span>
      </button>
      <Show when={dialogState() !== "hidden"}>
        <div
          role="dialog"
          aria-label={`${props.schema.name} schema information`}
          sx={[styles.dialog, dialogState() === "hiding" ? styles.hiding : styles.showing]}
          style={popoutPosition()}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && dialogState() === "hiding")
              setDialogState("hidden");
          }}
          onAnimationCancel={(event) => {
            if (event.target === event.currentTarget && dialogState() === "hiding")
              setDialogState("hidden");
          }}
        >
          <div sx={[styles.dialogTitle, typeColor()]}>{props.schema.name}</div>
          <div sx={styles.details}>
            <div sx={styles.detail}>
              <span sx={styles.detailLabel}>Package</span>
              <span sx={styles.detailValue}>{props.packageName}</span>
            </div>
            <div sx={styles.detail}>
              <span sx={styles.detailLabel}>Description</span>
              <span sx={styles.detailValue}>{props.schema.description}</span>
            </div>
          </div>
          <div sx={styles.actions}>
            <button type="button" disabled sx={[styles.action, styles.leftAction]}>
              More Info
            </button>
            <button
              type="button"
              sx={[styles.action, styles.rightAction]}
              onClick={() => {
                close();
                trigger?.focus();
              }}
            >
              Close
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
