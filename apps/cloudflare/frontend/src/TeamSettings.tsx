import type { TeamMember, TeamRecord } from "@macrograph/cloud-api";

import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { For, Show, action, createSignal, type Component } from "solid-js";

import type { TeamsApiClient } from "./api";

import { runApi, runApiResult } from "./api";

interface TeamSettingsProps {
  readonly api: TeamsApiClient;
  readonly team: TeamRecord | undefined;
  readonly members: ReadonlyArray<TeamMember>;
  readonly onOpen: () => void;
  readonly onMembersChanged: () => void;
}

const AddTeamMemberForm: Component<{
  readonly onAdd: (userId: string, role: "admin" | "member") => Promise<boolean>;
  readonly canAssignAdmin: boolean;
}> = (props) => {
  const [newMemberId, setNewMemberId] = createSignal("");
  const [newMemberRole, setNewMemberRole] = createSignal<"admin" | "member">("member");
  const [addError, setAddError] = createSignal<string>();

  const addTeamMember = action(async function* (event: SubmitEvent) {
    event.preventDefault();
    const userId = newMemberId().trim();
    if (userId.length === 0) return;
    const added = await props.onAdd(userId, newMemberRole());
    yield;
    if (added) {
      setNewMemberId("");
      setAddError(undefined);
    } else {
      setAddError("User not found. They must sign in first.");
    }
  });

  return (
    <form sx={styles.addForm} onSubmit={addTeamMember}>
      <label sx={styles.srOnly} for="new-member-id">
        MacroGraph user ID
      </label>
      <input
        id="new-member-id"
        sx={[styles.input, styles.memberInput]}
        value={newMemberId()}
        onInput={(event) => {
          setNewMemberId(event.currentTarget.value);
          setAddError(undefined);
        }}
        placeholder="MacroGraph user ID"
      />
      <label sx={styles.srOnly} for="new-member-role">
        Role
      </label>
      <div sx={styles.relative}>
        <select
          id="new-member-role"
          sx={[styles.input, styles.addSelect]}
          value={newMemberRole()}
          onChange={(event) => setNewMemberRole(event.currentTarget.value as "admin" | "member")}
        >
          <option value="member">Member</option>
          <Show when={props.canAssignAdmin}>
            <option value="admin">Admin</option>
          </Show>
        </select>
        <IconLucideChevronDown {...stylex.attrs(styles.chevron)} />
      </div>
      <button sx={styles.submit}>Add member</button>
      <Show when={addError()}>
        {(error) => (
          <p role="alert" sx={styles.addError}>
            {error()}
          </p>
        )}
      </Show>
    </form>
  );
};

export const TeamSettings: Component<TeamSettingsProps> = (props) => {
  let dialog!: HTMLDialogElement;
  const canManage = () => props.team?.role === "owner" || props.team?.role === "admin";
  const canManageMember = (member: TeamMember) =>
    member.role !== "owner" &&
    (props.team?.role === "owner" || (props.team?.role === "admin" && member.role === "member"));
  const roleLabel = (role: TeamMember["role"]) => role.slice(0, 1).toUpperCase() + role.slice(1);

  const setTeamMember = action(async function* (userId: string, role: "admin" | "member") {
    const teamId = props.team?.id;
    if (teamId === undefined) return false;
    const result = await runApi(
      props.api.setMember({ params: { teamId, userId }, payload: { role } }),
    );
    yield;
    if (result !== undefined) props.onMembersChanged();
    return result !== undefined;
  });

  const removeTeamMember = action(async function* (userId: string) {
    const teamId = props.team?.id;
    if (teamId === undefined) return;
    const removed = await runApiResult(props.api.removeMember({ params: { teamId, userId } }));
    yield;
    if (removed) props.onMembersChanged();
  });

  return (
    <>
      <button
        type="button"
        sx={styles.settingsButton}
        onClick={() => {
          props.onOpen();
          dialog.showModal();
        }}
        aria-label="Team settings"
        title="Team settings"
      >
        <IconTablerSettings {...stylex.attrs(styles.icon)} />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="team-settings-title"
        sx={styles.dialog}
        onClick={(event) => {
          if (event.target === dialog) dialog.close();
        }}
      >
        <div sx={styles.header}>
          <div sx={styles.headerTeam}>
            <span sx={styles.teamInitial}>{props.team?.name.slice(0, 1).toUpperCase() ?? "T"}</span>
            <div style={{ "min-width": "0" }}>
              <h2 id="team-settings-title" sx={styles.dialogTitle}>
                {props.team?.name ?? "Team settings"}
              </h2>
              <p sx={styles.teamMeta}>
                {props.team?.kind === "personal" ? "Personal team" : "Shared team"}
                <span sx={styles.separator}>·</span>
                {roleLabel(props.team?.role ?? "member")}
              </p>
            </div>
          </div>
          <button
            type="button"
            sx={styles.close}
            onClick={() => dialog.close()}
            aria-label="Close team settings"
          >
            <IconBiX {...stylex.attrs(styles.icon)} />
          </button>
        </div>
        <div sx={styles.body}>
          <Show when={canManage()}>
            <section sx={styles.addSection}>
              <div style={{ "margin-bottom": "12px" }}>
                <h3 sx={styles.sectionTitle}>Add a team member</h3>
                <p sx={styles.sectionDescription}>
                  Add someone using the user ID from their MacroGraph account.
                </p>
              </div>
              <AddTeamMemberForm
                onAdd={setTeamMember}
                canAssignAdmin={props.team?.role === "owner"}
              />
            </section>
          </Show>
          <section sx={styles.section}>
            <div sx={styles.membersHeading}>
              <div>
                <h3 sx={styles.sectionTitle}>Members</h3>
                <p sx={styles.membersDescription}>
                  People with access to this team and its projects.
                </p>
              </div>
              <span sx={styles.badge}>{props.members.length}</span>
            </div>
            <div sx={styles.memberList}>
              <For each={props.members} fallback={<p sx={styles.empty}>No members found</p>}>
                {(member) => (
                  <div sx={styles.memberRow}>
                    <span sx={styles.memberAvatar}>{member.userId.slice(0, 2).toUpperCase()}</span>
                    <div sx={styles.grow}>
                      <span sx={styles.memberId}>{member.userId}</span>
                    </div>
                    <Show
                      when={canManageMember(member)}
                      fallback={<span sx={styles.roleBadge}>{roleLabel(member.role)}</span>}
                    >
                      <div sx={styles.relative}>
                        <select
                          aria-label={`Role for ${member.userId}`}
                          sx={[styles.input, styles.roleSelect]}
                          value={member.role}
                          onChange={(event) =>
                            void setTeamMember(
                              member.userId,
                              event.currentTarget.value as "admin" | "member",
                            )
                          }
                        >
                          <option value="member">Member</option>
                          <Show when={props.team?.role === "owner"}>
                            <option value="admin">Admin</option>
                          </Show>
                        </select>
                        <IconLucideChevronDown {...stylex.attrs(styles.roleChevron)} />
                      </div>
                      <button
                        type="button"
                        sx={styles.remove}
                        onClick={() => void removeTeamMember(member.userId)}
                        aria-label={`Remove ${member.userId}`}
                        title="Remove member"
                      >
                        <IconBiX {...stylex.attrs(styles.smallIcon)} />
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </section>
        </div>
      </dialog>
    </>
  );
};

const sm = "@media (min-width: 640px)";
const styles = stylex.create({
  addForm: {
    display: "grid",
    gap: 8,
    gridTemplateColumns: { default: "minmax(0,1fr)", [sm]: "minmax(0,1fr) 7rem auto" },
  },
  addError: { gridColumn: "1 / -1", fontSize: 12, color: colors.red11 },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  input: {
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: colors.gray6, ":focus": colors.gray8 },
    backgroundColor: colors.gray1,
    color: colors.gray12,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
  },
  memberInput: {
    minWidth: 0,
    padding: "8px 12px",
    fontFamily: "monospace",
    fontSize: 12,
    "::placeholder": { fontFamily: "sans-serif", color: colors.gray9 },
  },
  relative: { position: "relative" },
  addSelect: {
    width: "100%",
    height: "100%",
    appearance: "none",
    padding: "8px 32px 8px 12px",
    fontSize: 12,
  },
  chevron: {
    pointerEvents: "none",
    position: "absolute",
    right: 10,
    top: "50%",
    width: 12,
    height: 12,
    transform: "translateY(-50%)",
    color: colors.gray10,
  },
  submit: {
    borderRadius: 6,
    padding: "8px 16px",
    backgroundColor: { default: colors.gray12, ":hover": colors.gray11 },
    color: colors.gray1,
    fontSize: 12,
    fontWeight: 600,
    transition: "150ms",
  },
  settingsButton: {
    display: "grid",
    width: 32,
    height: 32,
    flexShrink: 0,
    placeItems: "center",
    borderRadius: 4,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: { default: colors.gray2, ":hover": colors.gray3 },
    color: { default: colors.gray11, ":hover": colors.gray12 },
  },
  icon: { width: 16, height: 16, flexShrink: 0 },
  smallIcon: { width: 14, height: 14, flexShrink: 0 },
  dialog: {
    margin: "auto",
    maxHeight: "min(44rem, calc(100% - 2rem))",
    width: "min(38rem, calc(100% - 1.5rem))",
    overflow: "hidden",
    borderRadius: 12,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray2,
    padding: 0,
    fontSize: 14,
    color: colors.gray12,
    boxShadow: "0 25px 50px -12px rgb(0 0 0 / .25)",
    "::backdrop": { backgroundColor: "rgb(0 0 0 / .75)" },
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    borderBottom: `1px solid ${colors.gray5}`,
    paddingBlock: 20,
    paddingInline: { default: 20, [sm]: 24 },
  },
  headerTeam: { display: "flex", minWidth: 0, alignItems: "center", gap: 12 },
  teamInitial: {
    display: "grid",
    width: 40,
    height: 40,
    flexShrink: 0,
    placeItems: "center",
    borderRadius: 8,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray4,
    fontSize: 14,
    fontWeight: 600,
  },
  dialogTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: "-0.025em",
  },
  teamMeta: { marginTop: 2, fontSize: 12, color: colors.gray10 },
  separator: { paddingInline: 6, color: colors.gray7 },
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
  body: { maxHeight: "calc(min(44rem, 100vh - 2rem) - 5.1rem)", overflowY: "auto" },
  addSection: {
    borderBottom: `1px solid ${colors.gray5}`,
    paddingBlock: 20,
    paddingInline: { default: 20, [sm]: 24 },
  },
  section: { paddingBlock: 20, paddingInline: { default: 20, [sm]: 24 } },
  sectionTitle: { fontSize: 12, fontWeight: 600, color: colors.gray12 },
  sectionDescription: { marginTop: 4, fontSize: 12, lineHeight: "20px", color: colors.gray10 },
  membersDescription: { marginTop: 4, fontSize: 12, color: colors.gray10 },
  membersHeading: {
    marginBottom: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    borderRadius: 9999,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray3,
    padding: "2px 8px",
    fontSize: 10,
    fontWeight: 500,
    color: colors.gray11,
  },
  memberList: {
    overflow: "hidden",
    borderRadius: 8,
    border: `1px solid ${colors.gray5}`,
    backgroundColor: colors.gray1,
  },
  empty: { padding: "24px 16px", textAlign: "center", fontSize: 12, color: colors.gray10 },
  memberRow: {
    display: "flex",
    minHeight: 56,
    alignItems: "center",
    gap: 12,
    paddingBlock: 10,
    paddingInline: { default: 12, [sm]: 16 },
    borderTopColor: colors.gray5,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  memberAvatar: {
    display: "grid",
    width: 32,
    height: 32,
    flexShrink: 0,
    placeItems: "center",
    borderRadius: 9999,
    backgroundColor: colors.gray4,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: 600,
    color: colors.gray11,
  },
  grow: { minWidth: 0, flex: 1 },
  memberId: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "monospace",
    fontSize: 12,
    color: colors.gray12,
  },
  roleBadge: {
    borderRadius: 9999,
    backgroundColor: colors.gray3,
    padding: "4px 8px",
    fontSize: 10,
    fontWeight: 500,
    color: colors.gray11,
  },
  roleSelect: {
    appearance: "none",
    backgroundColor: colors.gray2,
    padding: "6px 28px 6px 10px",
    fontSize: 11,
  },
  roleChevron: {
    pointerEvents: "none",
    position: "absolute",
    right: 8,
    top: "50%",
    width: 12,
    height: 12,
    transform: "translateY(-50%)",
    color: colors.gray10,
  },
  remove: {
    display: "grid",
    width: 32,
    height: 32,
    flexShrink: 0,
    placeItems: "center",
    borderRadius: 6,
    color: { default: colors.gray9, ":hover": colors.red11 },
    backgroundColor: { default: "transparent", ":hover": colors.red3 },
    transition: "150ms",
  },
});
