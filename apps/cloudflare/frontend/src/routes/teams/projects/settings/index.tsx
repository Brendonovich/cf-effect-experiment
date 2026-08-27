import { CredentialTable, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useNavigate, useParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, Loading, action, createOptimisticStore, createSignal } from "solid-js";

import { runApi, runApiResult } from "../../../../api";
import { useWorkspace } from "../../../../App";
import { availableCredentials } from "./credentialViewModel";

type State = {
  context: { userIds: string[] };
  mode: "team" | "restricted";
};

export const ProjectSettingsRoute = () => {
  const workspace = useWorkspace();
  const params = useParams<{ projectId: string }>();
  const projectId = () => params.projectId;
  const project = workspace.selectedProject;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteState, setDeleteState] = createSignal<"idle" | "deleting" | "error">("idle");
  const [refreshingCredentials, setRefreshingCredentials] = createSignal(false);
  const canManage = () => workspace.selectedTeam()?.role === "owner";
  const canManageCredentials = () => {
    const role = workspace.selectedTeam()?.role;
    return (
      (role === "owner" || role === "member") && project()?.createdBy === workspace.currentUserId()
    );
  };
  const projectAccessKey = () => ["project-access", projectId()] as const;
  const projectAccessQuery = createQuery(() => ({
    queryKey: projectAccessKey(),
    queryFn: async () => {
      const body = await runApi(
        workspace.api.projects.getAccess({ params: { projectId: projectId() } }),
      );
      if (body === undefined) throw new Error("Could not load project access");
      return body;
    },
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  }));
  const credentialsKey = () => ["credentials", projectId()] as const;
  const credentialsQuery = createQuery(() => ({
    queryKey: credentialsKey(),
    queryFn: async () => {
      const catalog = await runApi(
        workspace.api.credentials.list({ params: { projectId: projectId() } }),
      );
      if (catalog === undefined) throw new Error("Could not load credentials");
      return catalog;
    },
    retry: false,
  }));
  const [rememberedUserIds, setRememberedUserIds] = createSignal<string[]>();
  const [optimisticAccess, setOptimisticAccess] = createOptimisticStore<State>(
    () => ({
      context: {
        userIds:
          rememberedUserIds() ??
          (projectAccessQuery.data?.access === "restricted"
            ? [...projectAccessQuery.data.userIds]
            : []),
      },
      mode: projectAccessQuery.data?.access === "restricted" ? "restricted" : "team",
    }),
    { context: { userIds: [] }, mode: "team" },
  );
  let pendingAccessSave: Promise<unknown> = Promise.resolve();
  let latestAccessSave = 0;

  const saveAccess = action(async function* (access: State, saveId: number) {
    setOptimisticAccess(() => access);
    const currentProjectId = projectId();
    const operation = pendingAccessSave
      .catch(() => undefined)
      .then(() =>
        runApi(
          workspace.api.projects.setAccess({
            params: { projectId: currentProjectId },
            payload: {
              access: access.mode,
              userIds: access.mode === "restricted" ? access.context.userIds : [],
            },
          }),
        ),
      );
    pendingAccessSave = operation;
    const result = await operation;
    if (result === undefined) throw new Error("Could not update project access");
    yield;
    if (saveId !== latestAccessSave || currentProjectId !== projectId()) return;
    queryClient.setQueryData(["project-access", currentProjectId], {
      access: access.mode,
      userIds: [...result.userIds],
    });
    yield workspace.reloadProjects();
  });

  const updateAccess = (update: (state: State) => State) => {
    const current: State = {
      context: { userIds: [...optimisticAccess.context.userIds] },
      mode: optimisticAccess.mode,
    };
    const next = update(current);
    if (next === current) return;
    setRememberedUserIds(next.context.userIds);
    void saveAccess(next, ++latestAccessSave).catch(() => undefined);
  };
  const actions = {
    setMode(mode: State["mode"]) {
      updateAccess((state) => ({ ...state, mode }));
    },
    toggleUser(userId: string) {
      updateAccess((state) => {
        if (state.mode !== "restricted") return state;
        return {
          ...state,
          context: {
            userIds: state.context.userIds.includes(userId)
              ? state.context.userIds.filter((id) => id !== userId)
              : [...state.context.userIds, userId],
          },
        };
      });
    },
  };

  const deleteProject = action(async function* () {
    const selectedProject = project();
    if (
      selectedProject === undefined ||
      !window.confirm(`Delete "${selectedProject.name}"? This action cannot be undone.`)
    )
      return;
    setDeleteState("deleting");
    try {
      const removed = await runApiResult(
        workspace.api.projects.remove({ params: { projectId: projectId() } }),
      );
      if (!removed) {
        setDeleteState("error");
        return;
      }
      yield;
      queryClient.removeQueries({ queryKey: projectAccessKey() });
      void workspace.reloadProjects();
      navigate("/", { replace: true });
    } catch {
      setDeleteState("error");
    }
  });

  const refetchCredentials = action(async function* () {
    setRefreshingCredentials(true);
    const catalog = await runApi(
      workspace.api.credentials.refetch({ params: { projectId: projectId() } }),
    );
    yield;
    setRefreshingCredentials(false);
    if (catalog !== undefined) {
      queryClient.setQueryData(credentialsKey(), catalog);
      yield workspace.refreshEditorPluginData(projectId());
    }
  });

  return (
    <div sx={styles.root}>
      <div sx={styles.container}>
        <div style={{ "margin-bottom": "24px" }}>
          <div sx={styles.eyebrow}>Project settings</div>
          <Loading fallback={<div sx={styles.titleLoading} />}>
            <h1 sx={styles.pageTitle}>{project()?.name}</h1>
          </Loading>
        </div>
        <section sx={styles.card}>
          <div sx={styles.cardHeader}>
            <h2 sx={styles.cardTitle}>Access</h2>
            <p sx={styles.cardDescription}>
              Choose who in this team can open and manage this project.
            </p>
          </div>
          <Loading
            fallback={
              <LoadingState label="Loading permissions" style={styles.loadingPermissions} />
            }
          >
            <Show
              when={canManage()}
              fallback={<p sx={styles.message}>Only team owners can change project access.</p>}
            >
              <div sx={styles.accessBody}>
                <Show
                  when={!projectAccessQuery.isPending}
                  fallback={
                    <LoadingState label="Loading project access" style={styles.loadingAccess} />
                  }
                >
                  <div sx={styles.accessOptions}>
                    <button
                      type="button"
                      aria-pressed={optimisticAccess.mode === "team" ? "true" : "false"}
                      sx={[
                        styles.accessOption,
                        optimisticAccess.mode === "team" && styles.accessSelected,
                      ]}
                      onClick={() => actions.setMode("team")}
                    >
                      Everyone on the team
                    </button>
                    <button
                      type="button"
                      aria-pressed={optimisticAccess.mode === "restricted" ? "true" : "false"}
                      sx={[
                        styles.accessOption,
                        optimisticAccess.mode === "restricted" && styles.accessSelected,
                      ]}
                      onClick={() => actions.setMode("restricted")}
                    >
                      Specific people
                    </button>
                  </div>
                </Show>
                <Show when={!projectAccessQuery.isPending} fallback={null}>
                  <Show when={optimisticAccess.mode === "restricted"}>
                    <div>
                      <div sx={styles.membersLabel}>Team members</div>
                      <div sx={styles.memberList}>
                        <Loading
                          fallback={
                            <LoadingState
                              label="Loading team members"
                              style={styles.loadingMembers}
                            />
                          }
                        >
                          <For each={workspace.teamMembers()}>
                            {(member) => (
                              <label sx={styles.member}>
                                <input
                                  type="checkbox"
                                  checked={optimisticAccess.context.userIds.includes(member.userId)}
                                  onChange={() => actions.toggleUser(member.userId)}
                                />
                                <span sx={styles.memberId} title={member.email ?? undefined}>
                                  {member.email ?? "Email unavailable"}
                                </span>
                                <span sx={styles.memberRole}>{member.role}</span>
                              </label>
                            )}
                          </For>
                        </Loading>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>
          </Loading>
        </section>
        <section sx={styles.spacedCard}>
          <div sx={styles.credentialHeader}>
            <div sx={styles.tableHeading}>
              <h2 sx={styles.credentialHeading}>Credentials</h2>
              <span sx={styles.credentialCount}>
                {credentialsQuery.data
                  ? (availableCredentials(credentialsQuery.data)?.length ?? 0)
                  : 0}
              </span>
            </div>
            <button
              type="button"
              disabled={
                !canManageCredentials() || refreshingCredentials() || credentialsQuery.isPending
              }
              sx={styles.refetch}
              title={
                canManageCredentials()
                  ? "Reload credentials from the provider"
                  : "Only the project creator with an owner or member role can refresh credentials"
              }
              onClick={() => void refetchCredentials()}
            >
              {refreshingCredentials() ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <Show
            when={!credentialsQuery.isPending}
            fallback={
              <LoadingState label="Loading credentials" style={styles.loadingCredentials} />
            }
          >
            <Show
              when={!credentialsQuery.isError && credentialsQuery.data}
              fallback={
                <p role="alert" sx={styles.credentialError}>
                  Credentials could not be loaded.
                </p>
              }
            >
              {(catalog) => (
                <Show when={availableCredentials(catalog())}>
                  {(credentials) => (
                    <div sx={styles.tableContainer}>
                      <CredentialTable credentials={credentials()} />
                    </div>
                  )}
                </Show>
              )}
            </Show>
          </Show>
        </section>
        <Show when={canManage()}>
          <section sx={styles.danger}>
            <div sx={styles.dangerHeader}>
              <h2 sx={styles.dangerTitle}>Danger zone</h2>
              <p sx={styles.cardDescription}>
                Permanently delete this project, its deployments, and execution history.
              </p>
            </div>
            <div sx={styles.dangerBody}>
              <div>
                <div sx={styles.messageTitle}>Delete project</div>
                <div sx={styles.cardDescription}>This action cannot be undone.</div>
              </div>
              <button
                type="button"
                disabled={deleteState() === "deleting"}
                sx={styles.deleteButton}
                onClick={() => void deleteProject()}
              >
                {deleteState() === "deleting" ? "Deleting..." : "Delete project"}
              </button>
            </div>
            <Show when={deleteState() === "error"}>
              <p role="alert" sx={styles.deleteError}>
                Project deletion failed. Please try again.
              </p>
            </Show>
          </section>
        </Show>
      </div>
    </div>
  );
};

const sm = "@media (min-width: 640px)";
const md = "@media (min-width: 768px)";
const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });
const styles = stylex.create({
  root: {
    height: "100%",
    overflowY: "auto",
    backgroundColor: colors.gray2,
    padding: { default: 24, [md]: 40 },
  },
  container: { marginInline: "auto", maxWidth: 672 },
  eyebrow: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: ".2em",
    color: colors.gray11,
  },
  titleLoading: {
    marginTop: 4,
    width: 160,
    height: 28,
    borderRadius: 4,
    backgroundColor: colors.gray4,
    animation: `${pulse} 2s infinite`,
  },
  pageTitle: { marginTop: 4, fontSize: 20, fontWeight: 600, color: colors.gray12 },
  card: { borderRadius: 8, border: `1px solid ${colors.gray5}`, backgroundColor: colors.gray1 },
  spacedCard: { marginTop: 24 },
  cardHeader: { borderBottom: "1px solid transparent", padding: "16px 20px 4px" },
  cardTitle: { fontSize: 14, fontWeight: 500, color: colors.gray12 },
  cardDescription: { marginTop: 4, fontSize: 12, color: colors.gray11 },
  loadingPermissions: { height: 104 },
  loadingAccess: { height: 64 },
  loadingMembers: { height: 36 },
  loadingCredentials: { height: 96 },
  message: { padding: "16px 20px", fontSize: 14, color: colors.gray11 },
  accessBody: { display: "flex", flexDirection: "column", gap: 20, padding: 20 },
  accessOptions: {
    display: "grid",
    gap: 2,
    gridTemplateColumns: { default: "1fr", [sm]: "repeat(2,minmax(0,1fr))" },
    borderRadius: 7,
    backgroundColor: colors.gray3,
    padding: 3,
  },
  accessOption: {
    borderWidth: 0,
    borderRadius: 5,
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    padding: "8px 10px",
    textAlign: "center",
    fontSize: 12,
    fontWeight: 500,
    color: colors.gray11,
  },
  accessSelected: {
    backgroundColor: colors.gray1,
    boxShadow: `0 0 0 1px ${colors.gray5}`,
    color: colors.gray12,
  },
  membersLabel: { marginBottom: 8, fontSize: 12, fontWeight: 500, color: colors.gray11 },
  memberList: { borderRadius: 6, border: `1px solid ${colors.gray5}` },
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
    color: colors.gray12,
  },
  memberRole: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: ".025em",
    color: colors.gray11,
  },
  credentialHeader: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
  },
  tableHeading: { display: "flex", alignItems: "center", gap: 6 },
  credentialHeading: { margin: 0, fontSize: 14, fontWeight: 500, color: colors.gray12 },
  credentialCount: {
    borderRadius: 9999,
    backgroundColor: colors.gray4,
    paddingBlock: 1,
    paddingInline: 6,
    fontSize: 9,
    fontVariantNumeric: "tabular-nums",
    color: colors.gray11,
  },
  refetch: {
    flexShrink: 0,
    borderRadius: 6,
    borderWidth: 0,
    backgroundColor: "transparent",
    padding: 0,
    fontSize: 10,
    fontWeight: 500,
    color: { default: colors.gray9, ":hover": colors.gray12 },
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.5 },
  },
  tableContainer: { marginTop: 8 },
  credentialError: { padding: 20, fontSize: 14, color: colors.red10 },
  messageTitle: { fontSize: 14, fontWeight: 500, color: colors.gray12 },
  danger: {
    marginTop: 24,
    borderRadius: 8,
    border: `1px solid ${colors.red6}`,
    backgroundColor: "color-mix(in srgb, var(--red-2) 40%, transparent)",
  },
  dangerHeader: { borderBottom: `1px solid ${colors.red6}`, padding: "16px 20px" },
  dangerTitle: { fontWeight: 600, color: colors.red11 },
  dangerBody: {
    display: "flex",
    flexDirection: { default: "column", [sm]: "row" },
    alignItems: { default: "flex-start", [sm]: "center" },
    justifyContent: { default: "flex-start", [sm]: "space-between" },
    gap: 12,
    padding: 20,
  },
  deleteButton: {
    flexShrink: 0,
    borderRadius: 6,
    backgroundColor: { default: colors.red9, ":hover": colors.red10 },
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: "white",
    transition: "150ms",
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.6 },
  },
  deleteError: {
    borderTop: `1px solid ${colors.red6}`,
    padding: "12px 20px",
    fontSize: 12,
    color: colors.red11,
  },
});
