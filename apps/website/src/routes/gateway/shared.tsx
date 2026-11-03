import type { JSX } from "@solidjs/web";

import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { getRequestEvent, isServer } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";

import { showToast } from "../../Toasts";

export const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The website's origin, during the server render too. */
export const siteOrigin = () =>
  isServer
    ? new URL(getRequestEvent()?.request.url ?? "https://macrograph.app").origin
    : location.origin;

export const copy = (value: string, label: string) =>
  void navigator.clipboard
    .writeText(value)
    .then(() => showToast({ tone: "success", content: `Copied ${label}` }));

/** A labelled value with a copy button, such as an endpoint URL or a new secret. */
export function CopyField(props: {
  readonly label: string;
  readonly value: string;
  readonly description?: JSX.Element;
}) {
  return (
    <div sx={styles.field}>
      <span sx={styles.fieldLabel}>{props.label}</span>
      <div sx={styles.copyField}>
        <code sx={styles.copyValue}>{props.value}</code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          sx={styles.copyButton}
          onClick={() => copy(props.value, props.label.toLowerCase())}
        >
          Copy
        </Button>
      </div>
      <Show when={props.description}>
        {(description) => <span sx={styles.fieldDescription}>{description()}</span>}
      </Show>
    </div>
  );
}

export function Section(props: {
  readonly title: string;
  readonly description?: JSX.Element;
  readonly actions?: JSX.Element;
  readonly children: JSX.Element;
}) {
  return (
    <section sx={styles.section} aria-label={props.title}>
      <div sx={styles.sectionHeader}>
        <div>
          <h2 sx={styles.sectionTitle}>{props.title}</h2>
          <Show when={props.description}>
            {(description) => <p sx={styles.sectionDescription}>{description()}</p>}
          </Show>
        </div>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

export const narrow = "@media (max-width: 639px)";

export const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: { default: 32, [narrow]: 24 } },
  loading: { height: 160 },
  section: { display: "flex", flexDirection: "column", gap: 10 },
  sectionHeader: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    paddingInline: { default: 0, [narrow]: 16 },
  },
  sectionTitle: { margin: 0, fontSize: 14, fontWeight: 500, color: colors.gray12 },
  sectionDescription: {
    margin: 0,
    marginTop: 2,
    fontSize: 13,
    lineHeight: "18px",
    color: colors.gray10,
  },
  list: {
    overflow: "hidden",
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderInlineWidth: { default: 1, [narrow]: 0 },
    borderRadius: { default: 8, [narrow]: 0 },
    backgroundColor: colors.gray2,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingBlock: 10,
    paddingInline: 16,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 16,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  body: { flex: 1, minWidth: 0 },
  name: { margin: 0, fontSize: 14, lineHeight: "20px", fontWeight: 500 },
  detail: {
    margin: 0,
    marginTop: 2,
    overflow: "hidden",
    fontSize: 13,
    color: colors.gray10,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  muted: { fontSize: 13, color: colors.gray10 },
  empty: { margin: 0, padding: 20, fontSize: 13, color: colors.gray10 },
  link: { color: colors.gray12, textDecoration: "underline" },
  retry: {
    border: 0,
    padding: 0,
    backgroundColor: "transparent",
    fontSize: 13,
    color: colors.gray12,
    textDecoration: "underline",
    cursor: "pointer",
  },
  code: {
    margin: 0,
    padding: 12,
    overflow: "auto",
    borderRadius: 6,
    backgroundColor: colors.gray1,
    fontSize: 12,
    lineHeight: "18px",
    color: colors.gray11,
    whiteSpace: "pre",
  },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: 500, color: colors.gray11 },
  fieldDescription: { fontSize: 12, color: colors.gray10 },
  copyField: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 6,
    paddingInlineStart: 12,
    paddingInlineEnd: 6,
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray2,
  },
  copyValue: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    fontSize: 13,
    color: colors.gray12,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  copyButton: { borderRadius: 6 },
  input: {
    flex: 1,
    minWidth: 0,
    paddingBlock: 7,
    paddingInline: 10,
    borderColor: { default: colors.gray5, ":focus": colors.gray8 },
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 6,
    outline: "none",
    backgroundColor: colors.gray1,
    fontSize: 13,
    color: colors.gray12,
  },
  form: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  button: { borderRadius: 6 },
  callout: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    borderColor: colors.gray6,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray3,
    fontSize: 13,
    color: colors.gray11,
  },
  badge: {
    flexShrink: 0,
    paddingBlock: 1,
    paddingInline: 7,
    borderRadius: 999,
    backgroundColor: colors.gray4,
    fontSize: 11,
    fontWeight: 500,
    color: colors.gray11,
  },
  badgeGood: { backgroundColor: "rgb(48 164 108 / 0.2)", color: "#4cc38a" },
  badgeWarn: { backgroundColor: "rgb(234 179 8 / 0.2)", color: "#eab308" },
  badgeBad: { backgroundColor: colors.red4, color: colors.red11 },
  checks: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 4,
  },
  check: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    paddingBlock: 3,
    fontSize: 12,
    color: colors.gray11,
    cursor: "pointer",
  },
  checkLabel: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});
