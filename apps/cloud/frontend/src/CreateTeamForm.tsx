import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { action, createSignal, type Component } from "solid-js";

import type { TeamsApiClient } from "./api";

import { runApi } from "./api";

interface CreateTeamDialogProps {
  readonly api: TeamsApiClient;
  readonly onCreated: (teamId: string) => void;
  readonly dialogRef: (dialog: HTMLDialogElement) => void;
}

export const CreateTeamDialog: Component<CreateTeamDialogProps> = (props) => {
  const [name, setName] = createSignal("");
  let dialog!: HTMLDialogElement;

  const createTeam = action(async function* (event: SubmitEvent) {
    event.preventDefault();
    const teamName = name().trim();
    if (teamName.length === 0) return;
    const body = await runApi(props.api.create({ payload: { name: teamName } }));
    yield;
    if (body === undefined) return;
    setName("");
    dialog.close();
    props.onCreated(body.team.id);
  });

  return (
    <dialog
      ref={(element) => {
        dialog = element;
        props.dialogRef(element);
      }}
      aria-labelledby="create-team-title"
      sx={styles.dialog}
      onClick={(event) => {
        if (event.target === dialog) dialog.close();
      }}
    >
      <div sx={styles.header}>
        <div>
          <h2 id="create-team-title" sx={styles.title}>
            Create a new team
          </h2>
          <p sx={styles.description}>A shared workspace for projects and collaborators.</p>
        </div>
        <button
          type="button"
          sx={styles.close}
          onClick={() => dialog.close()}
          aria-label="Close create team dialog"
        >
          <IconBiX {...stylex.attrs(styles.icon)} />
        </button>
      </div>
      <form sx={styles.form} onSubmit={createTeam}>
        <label for="new-team-name" sx={styles.label}>
          Team name
        </label>
        <input
          id="new-team-name"
          sx={styles.input}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          placeholder="Acme studio"
          autofocus
        />
        <div sx={styles.actions}>
          <button type="button" sx={styles.cancel} onClick={() => dialog.close()}>
            Cancel
          </button>
          <button sx={styles.submit}>Create team</button>
        </div>
      </form>
    </dialog>
  );
};

const sm = "@media (min-width: 640px)";
const styles = stylex.create({
  dialog: {
    margin: "auto",
    width: "min(30rem, calc(100% - 1.5rem))",
    overflow: "hidden",
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.gray6,
    backgroundColor: colors.gray2,
    padding: 0,
    fontSize: 14,
    color: colors.gray12,
    boxShadow: "0 25px 50px -12px rgb(0 0 0 / 0.25)",
    "::backdrop": { backgroundColor: "rgb(0 0 0 / 0.75)" },
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    borderBottom: `1px solid ${colors.gray5}`,
    paddingBlock: 20,
    paddingInline: { default: 20, [sm]: 24 },
  },
  title: { fontSize: 16, fontWeight: 600, letterSpacing: "-0.025em" },
  description: { marginTop: 4, fontSize: 12, lineHeight: "20px", color: colors.gray10 },
  close: {
    display: "grid",
    width: 32,
    height: 32,
    flexShrink: 0,
    placeItems: "center",
    borderRadius: 6,
    color: { default: colors.gray10, ":hover": colors.gray12 },
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    transition: "150ms",
  },
  icon: { width: 16, height: 16, flexShrink: 0 },
  form: { padding: { default: 20, [sm]: 24 } },
  label: { display: "block", marginBottom: 8, fontSize: 12, fontWeight: 500, color: colors.gray11 },
  input: {
    width: "100%",
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    backgroundColor: colors.gray1,
    padding: "10px 12px",
    fontSize: 14,
    color: colors.gray12,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
    borderColor: { default: colors.gray6, ":focus": colors.gray8 },
    "::placeholder": { color: colors.gray9 },
  },
  actions: { marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 },
  cancel: {
    borderRadius: 6,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 500,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    transition: "150ms",
  },
  submit: {
    borderRadius: 6,
    backgroundColor: { default: colors.gray12, ":hover": colors.gray11 },
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: 600,
    color: colors.gray1,
    transition: "150ms",
  },
});
