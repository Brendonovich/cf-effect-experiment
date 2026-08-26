import type { ProjectRecord, TeamMember } from "@macrograph/cloud-api";

import { createStateMachine } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { For, Show, action, type Component } from "solid-js";

import type { ProjectsApiClient } from "./api";

import { runApi } from "./api";

interface CreateProjectDialogProps {
  readonly api: ProjectsApiClient;
  readonly teamId: string | undefined;
  readonly members: ReadonlyArray<TeamMember>;
  readonly onCreated: (project: ProjectRecord) => void;
  readonly dialogRef: (dialog: HTMLDialogElement) => void;
  readonly onClose?: () => void;
}

type State = {
  context: { name: string; userIds: string[] };
  mode: "team" | "restricted";
};

export const CreateProjectDialog: Component<CreateProjectDialogProps> = (props) => {
  const [state, actions] = createStateMachine(
    { context: { name: "", userIds: [] }, mode: "team" } as State,
    {
      setName(state, name: string) {
        state.context.name = name;
      },
      setMode(state, mode: State["mode"]) {
        state.mode = mode;
      },
      toggleUser(state, userId: string) {
        if (state.mode !== "restricted") return;
        state.context.userIds = state.context.userIds.includes(userId)
          ? state.context.userIds.filter((id) => id !== userId)
          : [...state.context.userIds, userId];
      },
      reset(state) {
        state.context.name = "";
        state.context.userIds = [];
        state.mode = "team";
      },
    },
  );
  let dialog!: HTMLDialogElement;

  const createProject = action(async function* (event: SubmitEvent) {
    event.preventDefault();
    const name = state.context.name.trim();
    if (name.length === 0) return;
    const body = await runApi(
      props.api.create({
        payload: {
          name,
          teamId: props.teamId,
          access: state.mode,
          userIds: state.mode === "restricted" ? state.context.userIds : [],
        },
      }),
    );
    yield;
    if (body === undefined) return;
    actions.reset();
    dialog.close();
    props.onCreated(body.project);
  });

  return (
    <dialog
      ref={(element) => {
        dialog = element;
        props.dialogRef(element);
      }}
      aria-labelledby="create-project-title"
      onClose={props.onClose}
      sx={styles.dialog}
      onClick={(event) => {
        if (event.target === dialog) dialog.close();
      }}
    >
      <div sx={styles.header}>
        <div>
          <h2 id="create-project-title" sx={styles.title}>
            Create a new project
          </h2>
          <p sx={styles.description}>Choose who on the team can access it.</p>
        </div>
        <button
          type="button"
          sx={styles.close}
          onClick={() => dialog.close()}
          aria-label="Close create project dialog"
        >
          <IconBiX {...stylex.attrs(styles.icon)} />
        </button>
      </div>
      <form sx={styles.form} onSubmit={createProject}>
        <label for="new-project-name" sx={styles.label}>
          Project name
        </label>
        <input
          id="new-project-name"
          sx={styles.input}
          value={state.context.name}
          onInput={(event) => actions.setName(event.currentTarget.value)}
          placeholder="My project"
          autofocus
        />
        <label for="new-project-access" sx={[styles.label, styles.accessLabel]}>
          Access
        </label>
        <div style={{ position: "relative" }}>
          <select
            id="new-project-access"
            sx={[styles.input, styles.select]}
            value={state.mode}
            onChange={(event) =>
              actions.setMode(event.currentTarget.value === "restricted" ? "restricted" : "team")
            }
          >
            <option value="team">Everyone in team</option>
            <option value="restricted">Specific members</option>
          </select>
          <IconLucideChevronDown {...stylex.attrs(styles.chevron)} />
        </div>
        <Show when={state.mode === "restricted"}>
          <div sx={styles.members}>
            <For each={props.members}>
              {(member) => (
                <label sx={styles.member}>
                  <input
                    type="checkbox"
                    checked={state.context.userIds.includes(member.userId)}
                    onChange={() => actions.toggleUser(member.userId)}
                  />
                  <span sx={styles.memberId}>{member.userId}</span>
                  <span sx={styles.role}>{member.role}</span>
                </label>
              )}
            </For>
          </div>
        </Show>
        <div sx={styles.actions}>
          <button type="button" sx={styles.cancel} onClick={() => dialog.close()}>
            Cancel
          </button>
          <button sx={styles.submit}>Create project</button>
        </div>
      </form>
    </dialog>
  );
};

const sm = "@media (min-width: 640px)";
const styles = stylex.create({
  dialog: {
    margin: "auto",
    maxHeight: "calc(100vh - 1.5rem)",
    width: "min(34rem, calc(100% - 1.5rem))",
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
  form: { maxHeight: "calc(100vh - 7rem)", overflowY: "auto", padding: { default: 20, [sm]: 24 } },
  label: { display: "block", marginBottom: 8, fontSize: 12, fontWeight: 500, color: colors.gray11 },
  accessLabel: { marginTop: 20 },
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
  select: { appearance: "none", paddingRight: 36 },
  chevron: {
    pointerEvents: "none",
    position: "absolute",
    right: 12,
    top: "50%",
    width: 16,
    height: 16,
    transform: "translateY(-50%)",
    color: colors.gray10,
  },
  members: {
    marginTop: 12,
    maxHeight: 192,
    overflowY: "auto",
    borderRadius: 6,
    border: `1px solid ${colors.gray5}`,
    backgroundColor: colors.gray1,
  },
  member: {
    display: "flex",
    cursor: "pointer",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    backgroundColor: { default: "transparent", ":hover": colors.gray2 },
    borderTopColor: colors.gray5,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  memberId: {
    minWidth: 0,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "monospace",
    fontSize: 12,
  },
  role: { fontSize: 10, textTransform: "capitalize", color: colors.gray10 },
  actions: { marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 8 },
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
