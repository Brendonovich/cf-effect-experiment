import { LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { For, Loading, createMemo, createSignal, resolve } from "solid-js";

import { runApi } from "../api";
import { useWorkspace } from "../App";
import { CreateProjectDialog } from "../CreateProjectForm";
import { CreateTeamDialog } from "../CreateTeamForm";

export const WorkspaceHomeRoute = () => {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  let createTeamDialog!: HTMLDialogElement;
  let createPersonalProjectDialog!: HTMLDialogElement;

  return (
    <div sx={styles.root}>
      <div sx={styles.container}>
        <div style={{ "margin-bottom": "32px" }}>
          <h1 sx={styles.title}>Teams and projects</h1>
          <p sx={styles.subtitle}>Choose a project to open its graphs.</p>
        </div>

        <Loading
          fallback={<LoadingState label="Loading teams and projects" style={styles.loading} />}
        >
          <div sx={styles.teamList}>
            <For
              each={workspace.teams()}
              fallback={
                <div sx={styles.empty}>
                  <p sx={styles.medium}>No teams available</p>
                  <p sx={styles.emptyDescription}>Create or join a team to start a project.</p>
                  <div sx={styles.emptyActions}>
                    <button
                      type="button"
                      sx={styles.newProject}
                      onClick={() => createPersonalProjectDialog.showModal()}
                    >
                      New personal project
                    </button>
                    <button
                      type="button"
                      sx={styles.newProject}
                      onClick={() => createTeamDialog.showModal()}
                    >
                      Create team
                    </button>
                  </div>
                </div>
              }
            >
              {(team) => {
                const teamProjects = () =>
                  workspace.projects().filter((project) => project.teamId === team.id);
                const teamPath = `/teams/${encodeURIComponent(team.id)}`;
                const [creatingProject, setCreatingProject] = createSignal(false);
                let createProjectDialog!: HTMLDialogElement;
                const teamMembers = createMemo(async () => {
                  if (!creatingProject()) return [];
                  return (
                    (await runApi(workspace.api.teams.listMembers({ params: { teamId: team.id } })))
                      ?.members ?? []
                  );
                });

                return (
                  <section sx={styles.team}>
                    <div sx={styles.teamHeader}>
                      <span sx={styles.teamInitial}>{team.name.slice(0, 1).toUpperCase()}</span>
                      <span sx={styles.grow}>
                        <span sx={styles.teamName}>{team.name}</span>
                        <span sx={styles.teamKind}>{team.kind} team</span>
                      </span>
                      <span sx={styles.count}>
                        {teamProjects().length}{" "}
                        {teamProjects().length === 1 ? "project" : "projects"}
                      </span>
                    </div>

                    <div sx={styles.projects}>
                      <For
                        each={teamProjects()}
                        fallback={
                          <div sx={styles.noProjects}>
                            <div sx={styles.noProjectsRow}>
                              <span>No projects yet.</span>
                              <button
                                type="button"
                                sx={styles.newProject}
                                onClick={() => {
                                  setCreatingProject(true);
                                  void resolve(teamMembers).then(() =>
                                    createProjectDialog.showModal(),
                                  );
                                }}
                              >
                                New project
                              </button>
                            </div>
                            <Loading fallback={null}>
                              <CreateProjectDialog
                                api={workspace.api.projects}
                                teamId={team.id}
                                members={teamMembers()}
                                dialogRef={(dialog) => (createProjectDialog = dialog)}
                                onClose={() => setCreatingProject(false)}
                                onCreated={(project) => {
                                  void workspace.reloadProjects();
                                  navigate(
                                    `/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}/editor`,
                                  );
                                }}
                              />
                            </Loading>
                          </div>
                        }
                      >
                        {(project) => (
                          <button
                            type="button"
                            sx={[styles.project, stylex.defaultMarker()]}
                            onClick={() =>
                              navigate(
                                `${teamPath}/projects/${encodeURIComponent(project.id)}/editor`,
                              )
                            }
                          >
                            <span sx={styles.projectInitial}>
                              {project.name.slice(0, 2).toUpperCase()}
                            </span>
                            <span sx={styles.grow}>
                              <span sx={styles.projectName}>{project.name}</span>
                            </span>
                            <span sx={styles.arrow}>&rarr;</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </section>
                );
              }}
            </For>
          </div>
        </Loading>
        <CreateTeamDialog
          api={workspace.api.teams}
          dialogRef={(dialog) => (createTeamDialog = dialog)}
          onCreated={(teamId) => {
            void workspace.reloadTeams();
            void workspace.reloadProjects();
            navigate(`/teams/${encodeURIComponent(teamId)}`);
          }}
        />
        <CreateProjectDialog
          api={workspace.api.projects}
          teamId={undefined}
          members={[]}
          dialogRef={(dialog) => (createPersonalProjectDialog = dialog)}
          onCreated={(project) => {
            void workspace.reloadTeams();
            void workspace.reloadProjects();
            navigate(
              `/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}/editor`,
            );
          }}
        />
      </div>
    </div>
  );
};

const sm = "@media (min-width: 640px)";
const styles = stylex.create({
  root: { height: "100%", overflowY: "auto", backgroundColor: colors.gray2 },
  container: {
    marginInline: "auto",
    width: "100%",
    maxWidth: 1024,
    paddingInline: { default: 20, [sm]: 32 },
    paddingBlock: { default: 40, [sm]: 56 },
  },
  title: {
    fontSize: 24,
    lineHeight: "32px",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    color: colors.gray12,
  },
  subtitle: { marginTop: 8, maxWidth: 576, fontSize: 14, lineHeight: "24px", color: colors.gray10 },
  loading: { height: 192 },
  teamList: { display: "flex", flexDirection: "column", gap: 20 },
  empty: {
    borderRadius: 12,
    border: `1px dashed ${colors.gray6}`,
    backgroundColor: colors.gray1,
    padding: "56px 24px",
    textAlign: "center",
  },
  medium: { fontWeight: 500, color: colors.gray12 },
  emptyDescription: { marginTop: 4, fontSize: 14, color: colors.gray10 },
  emptyActions: { marginTop: 20, display: "flex", justifyContent: "center", gap: 16 },
  team: {
    overflow: "hidden",
    borderRadius: 12,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray1,
    boxShadow: "0 1px 2px rgb(0 0 0 / 0.05)",
  },
  teamHeader: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: 12,
    borderBottom: `1px solid ${colors.gray5}`,
    paddingBlock: 12,
    paddingInline: { default: 16, [sm]: 20 },
    textAlign: "left",
  },
  teamInitial: {
    display: "grid",
    width: 36,
    height: 36,
    flexShrink: 0,
    placeItems: "center",
    borderRadius: 8,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray3,
    fontSize: 14,
    fontWeight: 600,
    color: colors.gray12,
  },
  grow: { minWidth: 0, flex: 1 },
  teamName: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 600,
    color: colors.gray12,
  },
  teamKind: { display: "block", fontSize: 12, textTransform: "capitalize", color: colors.gray9 },
  count: { fontSize: 12, color: colors.gray9 },
  projects: {
    display: "grid",
    gap: 1,
    backgroundColor: colors.gray5,
    gridTemplateColumns: { default: "minmax(0, 1fr)", [sm]: "repeat(2, minmax(0, 1fr))" },
  },
  noProjects: {
    gridColumn: { default: "auto", [sm]: "span 2 / span 2" },
    backgroundColor: colors.gray1,
    padding: "24px 20px",
    fontSize: 14,
    color: colors.gray10,
  },
  noProjectsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  newProject: {
    flexShrink: 0,
    borderRadius: 6,
    backgroundColor: { default: colors.gray12, ":hover": colors.gray11 },
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    color: colors.gray1,
    transition: "150ms",
  },
  project: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: 12,
    backgroundColor: { default: colors.gray1, ":hover": colors.gray2 },
    paddingBlock: 16,
    paddingInline: { default: 16, [sm]: 20 },
    textAlign: "left",
    transition: "150ms",
    gridColumn: {
      default: "auto",
      ":last-child:nth-child(odd)": { default: "auto", [sm]: "span 2 / span 2" },
    },
  },
  projectInitial: {
    display: "grid",
    width: 36,
    height: 36,
    flexShrink: 0,
    placeItems: "center",
    borderRadius: 6,
    backgroundColor: { default: colors.gray3, [stylex.when.ancestor(":hover")]: colors.gray4 },
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: 600,
    color: colors.gray11,
    boxShadow: `inset 0 0 0 1px ${colors.gray6}`,
    transition: "150ms",
  },
  projectName: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500,
    color: colors.gray12,
  },
  arrow: {
    color: { default: colors.gray8, [stylex.when.ancestor(":hover")]: colors.gray11 },
    transform: { default: "none", [stylex.when.ancestor(":hover")]: "translateX(2px)" },
    transition: "150ms",
  },
});
