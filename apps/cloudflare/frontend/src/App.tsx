import type { ProjectRecord, SessionStatus, TeamMember, TeamRecord } from "@macrograph/cloud-api";

import {
  AccountMenu,
  createEditorController,
  Editor,
  LoadingState,
  macrographLogo,
} from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useNavigate, useParams, useRouteMatches, type RouteSectionProps } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import {
  For,
  Show,
  Loading,
  action,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  refresh,
  resolve,
  untrack,
  useContext,
} from "solid-js";
import discoveredPluginSettings from "virtual:macrograph-plugin-settings";

import type { ApiClient } from "./api";

import { makeApiClient, runApi } from "./api";
import { createPresence } from "./createPresence";
import { CreateProjectDialog } from "./CreateProjectForm";
import { CreateTeamDialog } from "./CreateTeamForm";
import { makeEditorConnection } from "./editorConnection";
import { TeamSettings } from "./TeamSettings";

const publicWorkerOrigin = () =>
  new URL(
    import.meta.env.VITE_PUBLIC_WORKER_ORIGIN ?? import.meta.env.VITE_WORKER_URL ?? location.origin,
  ).origin;

const sleep = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));
interface WorkspaceContextValue {
  readonly api: ApiClient;
  readonly teams: () => ReadonlyArray<TeamRecord>;
  readonly projects: () => ReadonlyArray<ProjectRecord>;
  readonly reloadTeams: () => Promise<void>;
  readonly reloadProjects: () => Promise<void>;
  readonly selectedProject: () => ProjectRecord | undefined;
  readonly selectedTeam: () => TeamRecord | undefined;
  readonly currentUserId: () => string | undefined;
  readonly teamMembers: () => ReadonlyArray<TeamMember>;
  readonly editorUrl: (projectId: string) => string;
  readonly refreshEditorPluginData: (projectId: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue>();

export const useWorkspace = () => {
  return useContext(WorkspaceContext);
};

export function App(props: RouteSectionProps) {
  const navigate = useNavigate();
  const matches = useRouteMatches();
  const routeParams = useParams<{
    teamId?: string;
    projectId?: string;
    deploymentId?: string;
    eventId?: string;
  }>();
  const wasLoggedIn = localStorage.getItem("macrograph:loggedIn") === "true";
  const initialUserId = wasLoggedIn
    ? (localStorage.getItem("macrograph:userId") ?? undefined)
    : undefined;
  const [authenticated, setAuthenticated] = createSignal(wasLoggedIn);
  const [currentUserId, setCurrentUserId] = createSignal(initialUserId);
  const api = makeApiClient(publicWorkerOrigin());
  const [workspaceSwitcherState, setWorkspaceSwitcherState] = createSignal<
    "closed" | "team" | "project"
  >("closed");
  const [teamMembersRequested, setTeamMembersRequested] = createSignal(false);
  const [teamSwitcherPopup, setTeamSwitcherPopup] = createSignal<HTMLDivElement | null>(null);
  const [projectSwitcherPopup, setProjectSwitcherPopup] = createSignal<HTMLDivElement | null>(null);
  const teamSwitcherPresence = createPresence({
    show: () => workspaceSwitcherState() === "team",
    element: teamSwitcherPopup,
  });
  const projectSwitcherPresence = createPresence({
    show: () => workspaceSwitcherState() === "project",
    element: projectSwitcherPopup,
  });
  let workspaceSwitcher: HTMLDivElement | undefined;
  let createTeamDialog!: HTMLDialogElement;
  let createProjectDialog!: HTMLDialogElement;

  onSettled(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!workspaceSwitcher?.contains(event.target as globalThis.Node)) {
        setWorkspaceSwitcherState("closed");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setWorkspaceSwitcherState("closed");
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  });

  const params = () => routeParams;
  const workspaceView = () => matches().at(-1)?.route.info?.workspaceView;
  const [editorProjectId, setEditorProjectId] = createSignal<string>();
  createEffect(
    () => ({
      projectId: params().projectId,
      view: workspaceView(),
    }),
    (route) => {
      if (route.projectId === undefined) {
        setEditorProjectId(undefined);
        return;
      }
      if (route.view !== "editor") {
        if (untrack(editorProjectId) !== route.projectId) setEditorProjectId(undefined);
        return;
      }
      setEditorProjectId(route.projectId);
    },
  );
  const editorVisible = () =>
    workspaceView() === "editor" && editorProjectId() === params().projectId;

  const cloudAuth = createMemo<SessionStatus | { state: "failed" } | undefined>(async function* () {
    let state = await runApi(api.session.get());
    if (state === undefined) {
      yield { state: "failed" };
      return;
    }
    if (state.state === "disconnected") {
      state = await runApi(api.session.start());
    } else if (state.state === "pending") {
      state = await runApi(api.session.poll());
    }
    if (state === undefined) {
      yield { state: "failed" };
      return;
    }
    yield state;
    while (state.state === "pending") {
      await sleep(2000);
      const next = await runApi(api.session.poll());
      if (next === undefined) {
        yield { state: "failed" };
        return;
      }
      state = next;
      yield state;
    }
  });

  const teams = createMemo(async () => {
    if (!authenticated()) return [];
    return (await runApi(api.teams.list()))?.teams ?? [];
  });

  const projects = createMemo(async () => {
    if (!authenticated()) return [];
    return (await runApi(api.projects.list()))?.projects ?? [];
  });

  const selectedProject = createMemo(() =>
    projects().find(
      (project) => project.id === params().projectId && project.teamId === params().teamId,
    ),
  );

  const selectedTeam = createMemo(() => {
    const routeTeamId = params().teamId;
    return routeTeamId === undefined
      ? (teams().find((team) => team.kind === "personal") ?? teams()[0])
      : teams().find((team) => team.id === routeTeamId);
  });

  const selectedTeamId = () => params().teamId ?? selectedTeam()?.id;

  const teamMembers = createMemo(async () => {
    if (!teamMembersRequested() && workspaceView() !== "settings") return [];
    const teamId = selectedTeamId();
    if (!authenticated() || teamId === undefined) return [];
    return (await runApi(api.teams.listMembers({ params: { teamId } })))?.members ?? [];
  });

  const connectedUserEmail = createMemo(() => {
    const auth = cloudAuth();
    return auth?.state === "connected" ? auth.email : "";
  });
  const [cloudAuthView, setCloudAuthView] = createSignal<
    | SessionStatus
    | { state: "failed" }
    | { state: "pending"; verificationUrl: undefined }
    | { state: "connected"; userId: string | undefined }
  >(
    wasLoggedIn
      ? { state: "connected", userId: initialUserId }
      : { state: "pending", verificationUrl: undefined },
  );
  const verificationUrl = () => {
    const auth = cloudAuthView();
    return auth.state === "pending" ? auth.verificationUrl : undefined;
  };

  createEffect(cloudAuth, (auth) => {
    if (auth !== undefined) setCloudAuthView(auth);
    if (auth?.state === "connected") {
      setAuthenticated(true);
      setCurrentUserId(auth.userId);
      localStorage.setItem("macrograph:loggedIn", "true");
      localStorage.setItem("macrograph:userId", auth.userId);
    } else if (auth?.state === "pending" || auth?.state === "disconnected") {
      setAuthenticated(false);
      setCurrentUserId(undefined);
      localStorage.setItem("macrograph:loggedIn", "false");
      localStorage.removeItem("macrograph:userId");
    } else if (auth?.state === "failed") {
      setAuthenticated(false);
      setCurrentUserId(undefined);
    }
  });

  const disconnectCloud = action(async function* () {
    yield runApi(api.session.disconnect());
    localStorage.removeItem("macrograph:userId");
    localStorage.setItem("macrograph:loggedIn", "false");
    window.location.assign("/");
  });

  const visibleProjects = () => projects().filter((project) => project.teamId === selectedTeamId());
  const openWorkspaceView = (view: "editor" | "deployments" | "events" | "settings") => {
    const project = selectedProject();
    if (project === undefined) return;
    const projectPath = `/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}`;
    if (view === "editor") navigate(`${projectPath}/editor`);
    else if (view === "deployments")
      navigate(
        `${projectPath}/deployments${project.currentDeploymentId === null ? "" : `/${encodeURIComponent(project.currentDeploymentId)}`}`,
      );
    else navigate(`${projectPath}/${view}`);
  };
  const editorUrl = (projectId: string) => {
    const url = new URL("/rpc", window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("publicOrigin", publicWorkerOrigin());
    return url.href;
  };
  const editorController = createMemo(() => {
    const projectId = editorProjectId();
    const userId = currentUserId();
    if (projectId === undefined || userId === undefined) return undefined;
    return createEditorController({
      connection: makeEditorConnection(editorUrl(projectId), discoveredPluginSettings),
      workspaceId: projectId,
      userId,
      settingsDescriptors: discoveredPluginSettings,
      reconnect: true,
    });
  });

  const workspace: WorkspaceContextValue = {
    api,
    teams,
    projects,
    reloadTeams: async () => {
      refresh(teams);
      await resolve(teams);
    },
    reloadProjects: async () => {
      refresh(projects);
      await resolve(projects);
    },
    selectedProject,
    selectedTeam,
    currentUserId,
    teamMembers,
    editorUrl,
    refreshEditorPluginData: (projectId) =>
      editorProjectId() === projectId
        ? (editorController()?.refreshPluginData() ?? Promise.resolve())
        : Promise.resolve(),
  };

  return (
    <WorkspaceContext value={workspace}>
      <div sx={styles.root}>
        <Show when={cloudAuthView().state !== "connected"}>
          <div sx={styles.login}>
            <div sx={styles.loginContent}>
              <img src={macrographLogo} alt="MacroGraph" sx={styles.loginLogo} />
              <Show
                when={cloudAuthView().state !== "failed"}
                fallback={
                  <>
                    <h1 sx={styles.loginTitle}>Failed to connect to MacroGraph Cloud</h1>
                    <p sx={styles.loginDescription}>
                      MacroGraph could not reach the cloud service. Check your connection and try
                      again.
                    </p>
                    <button
                      type="button"
                      sx={styles.loginButton}
                      onClick={() => refresh(cloudAuth)}
                    >
                      Try again
                    </button>
                  </>
                }
              >
                <h1 sx={styles.loginTitle}>Connect to MacroGraph Cloud</h1>
                <p sx={styles.loginDescription}>
                  Sign in in a new tab, then return here. Keep this tab open while MacroGraph
                  completes the connection.
                </p>
                <a
                  href={verificationUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={verificationUrl() === undefined ? "true" : "false"}
                  onClick={(event) => {
                    if (verificationUrl() === undefined) event.preventDefault();
                  }}
                  sx={styles.loginButton}
                >
                  Continue to sign in
                </a>
                <div sx={styles.waiting}>
                  <span sx={styles.waitingDot} />
                  Waiting for authorization
                </div>
              </Show>
            </div>
          </div>
        </Show>
        <header sx={styles.header}>
          <div ref={workspaceSwitcher} sx={styles.workspaceSwitcher}>
            <img src={macrographLogo} alt="MacroGraph" sx={styles.logo} />
            <Loading fallback={<span sx={styles.switcherLoading} />}>
              <Show when={params().teamId !== undefined}>
                <>
                  <div sx={styles.switcherRoot}>
                    <button
                      type="button"
                      sx={styles.switcherButton}
                      aria-haspopup="menu"
                      aria-expanded={workspaceSwitcherState() === "team" ? "true" : "false"}
                      onClick={() =>
                        setWorkspaceSwitcherState((state) => (state === "team" ? "closed" : "team"))
                      }
                    >
                      <span sx={styles.smallInitial}>
                        {selectedTeam()?.name.slice(0, 1).toUpperCase() ?? "T"}
                      </span>
                      <span sx={styles.truncate}>{selectedTeam()?.name ?? "Select team"}</span>
                      <IconLucideChevronDown
                        {...stylex.attrs(styles.chevron, styles.chevronAuto)}
                      />
                    </button>
                    <Show when={teamSwitcherPresence.present()}>
                      <div
                        ref={setTeamSwitcherPopup}
                        sx={[
                          styles.popup,
                          teamSwitcherPresence.state() === "hiding"
                            ? styles.popupHiding
                            : styles.popupShowing,
                        ]}
                      >
                        <div sx={styles.popupTitle}>Teams</div>
                        <div sx={styles.teamMenu}>
                          <Loading
                            fallback={
                              <LoadingState label="Loading teams" style={styles.teamLoading} />
                            }
                          >
                            <For each={teams()}>
                              {(team) => (
                                <button
                                  type="button"
                                  role="menuitem"
                                  sx={styles.menuItem}
                                  onClick={() => {
                                    const firstProject = projects().find(
                                      (project) => project.teamId === team.id,
                                    );
                                    setWorkspaceSwitcherState("closed");
                                    navigate(
                                      firstProject === undefined
                                        ? `/teams/${encodeURIComponent(team.id)}`
                                        : `/teams/${encodeURIComponent(team.id)}/projects/${encodeURIComponent(firstProject.id)}/editor`,
                                    );
                                  }}
                                >
                                  <span sx={styles.menuInitial}>
                                    {team.name.slice(0, 1).toUpperCase()}
                                  </span>
                                  <span sx={styles.grow}>
                                    <span sx={styles.menuName}>{team.name}</span>
                                    <span sx={styles.menuMeta}>{team.role}</span>
                                  </span>
                                  <Show when={team.id === selectedTeamId()}>
                                    <IconTablerCheck {...stylex.attrs(styles.check)} />
                                  </Show>
                                </button>
                              )}
                            </For>
                          </Loading>
                        </div>
                        <div sx={styles.menuFooter}>
                          <button
                            type="button"
                            sx={[styles.menuItem, styles.newItem]}
                            onClick={() => {
                              setWorkspaceSwitcherState("closed");
                              createTeamDialog.showModal();
                            }}
                          >
                            <span sx={styles.addIconBox}>
                              <IconMaterialSymbolsAddRounded {...stylex.attrs(styles.addIcon)} />
                            </span>
                            New team
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
                  <Show when={params().projectId !== undefined}>
                    <>
                      <span sx={styles.slash}>/</span>
                      <div sx={styles.switcherRoot}>
                        <button
                          type="button"
                          sx={styles.switcherButton}
                          aria-haspopup="menu"
                          aria-expanded={workspaceSwitcherState() === "project" ? "true" : "false"}
                          onClick={() =>
                            setWorkspaceSwitcherState((state) =>
                              state === "project" ? "closed" : "project",
                            )
                          }
                        >
                          <span sx={styles.truncate}>
                            {selectedProject()?.name ?? "Select project"}
                          </span>
                          <IconLucideChevronDown {...stylex.attrs(styles.chevron)} />
                        </button>
                        <Show when={projectSwitcherPresence.present()}>
                          <div
                            ref={setProjectSwitcherPopup}
                            sx={[
                              styles.popup,
                              projectSwitcherPresence.state() === "hiding"
                                ? styles.popupHiding
                                : styles.popupShowing,
                            ]}
                          >
                            <div sx={styles.projectMenu}>
                              <div sx={styles.projectMenuTitle}>Projects</div>
                              <Loading
                                fallback={
                                  <LoadingState
                                    label="Loading projects"
                                    style={styles.projectLoading}
                                  />
                                }
                              >
                                <For
                                  each={visibleProjects()}
                                  fallback={<div sx={styles.noProjects}>No projects yet</div>}
                                >
                                  {(project) => (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      sx={styles.menuItem}
                                      onClick={() => {
                                        setWorkspaceSwitcherState("closed");
                                        navigate(
                                          `/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}/editor`,
                                        );
                                      }}
                                    >
                                      <span sx={[styles.menuInitial, styles.mono]}>
                                        {project.name.slice(0, 2).toUpperCase()}
                                      </span>
                                      <span sx={styles.projectName}>{project.name}</span>
                                      <Show when={project.id === params().projectId}>
                                        <IconTablerCheck {...stylex.attrs(styles.check)} />
                                      </Show>
                                    </button>
                                  )}
                                </For>
                              </Loading>
                            </div>
                            <div sx={styles.menuFooter}>
                              <button
                                type="button"
                                sx={[styles.menuItem, styles.newItem]}
                                onClick={() => {
                                  setWorkspaceSwitcherState("closed");
                                  setTeamMembersRequested(true);
                                  createProjectDialog.showModal();
                                }}
                              >
                                <span sx={styles.addIconBox}>
                                  <IconMaterialSymbolsAddRounded
                                    {...stylex.attrs(styles.addIcon)}
                                  />
                                </span>
                                New project
                              </button>
                            </div>
                          </div>
                        </Show>
                      </div>
                    </>
                  </Show>
                  <TeamSettings
                    api={api.teams}
                    team={selectedTeam()}
                    members={teamMembers()}
                    onOpen={() => setTeamMembersRequested(true)}
                    onMembersChanged={() => refresh(teamMembers)}
                  />
                  <CreateTeamDialog
                    api={api.teams}
                    dialogRef={(dialog) => (createTeamDialog = dialog)}
                    onCreated={(teamId) => {
                      refresh(teams);
                      navigate(`/teams/${encodeURIComponent(teamId)}`);
                    }}
                  />
                  <CreateProjectDialog
                    api={api.projects}
                    teamId={selectedTeamId()}
                    members={teamMembers()}
                    dialogRef={(dialog) => (createProjectDialog = dialog)}
                    onCreated={(project) => {
                      refresh(projects);
                      navigate(
                        `/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}/editor`,
                      );
                    }}
                  />
                </>
              </Show>
            </Loading>
          </div>
          <Show when={params().projectId !== undefined}>
            <nav sx={styles.nav}>
              <For each={["editor", "deployments", "events", "settings"] as const}>
                {(view) => (
                  <button
                    type="button"
                    sx={[
                      styles.navItem,
                      workspaceView() === view ? styles.navActive : styles.navIdle,
                    ]}
                    onClick={() => openWorkspaceView(view)}
                  >
                    {view}
                  </button>
                )}
              </For>
            </nav>
          </Show>
          <div sx={styles.account}>
            <Loading fallback={null}>
              <AccountMenu email={connectedUserEmail()} onSignOut={() => void disconnectCloud()} />
            </Loading>
          </div>
        </header>
        <main sx={styles.main}>
          <Show when={editorController()} keyed>
            {(controller) => (
              <div sx={editorVisible() ? styles.editor : styles.hidden}>
                <Editor controller={controller} />
              </div>
            )}
          </Show>
          <Show when={!editorVisible()}>{props.children}</Show>
        </main>
      </div>
    </WorkspaceContext>
  );
}

const sm = "@media (min-width: 640px)";
const md = "@media (min-width: 768px)";
const reduce = "@media (prefers-reduced-motion: reduce)";
const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });
const popupIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px) scale(.95)" },
  to: { opacity: 1, transform: "none" },
});
const popupOut = stylex.keyframes({ to: { opacity: 0, transform: "translateY(-4px) scale(.95)" } });
const styles = stylex.create({
  root: {
    position: "relative",
    display: "flex",
    width: "100vw",
    height: "100vh",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: colors.gray1,
    color: colors.gray12,
    fontSize: 14,
    colorScheme: "dark",
  },
  login: {
    position: "absolute",
    inset: 0,
    zIndex: 50,
    display: "grid",
    placeItems: "center",
    backgroundColor: colors.gray1,
    paddingInline: 24,
  },
  loginContent: { width: "100%", maxWidth: 384, textAlign: "center" },
  loginLogo: { marginInline: "auto", marginBottom: 28, width: 96, height: 96, borderRadius: 16 },
  loginTitle: { fontSize: 20, fontWeight: 600, letterSpacing: "-.025em" },
  loginDescription: { marginTop: 8, fontSize: 14, lineHeight: "24px", color: colors.gray10 },
  loginButton: {
    marginTop: 24,
    display: "inline-flex",
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: { default: colors.gray12, ":hover": colors.gray11 },
    paddingInline: 20,
    fontSize: 14,
    fontWeight: 600,
    color: colors.gray1,
    transition: "150ms",
  },
  waiting: {
    marginTop: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 12,
    color: colors.gray9,
  },
  waitingDot: {
    width: 6,
    height: 6,
    borderRadius: 9999,
    backgroundColor: "#60a5fa",
    animation: `${pulse} 2s infinite`,
  },
  header: {
    position: "relative",
    zIndex: 40,
    display: "grid",
    flexShrink: 0,
    gridTemplateColumns: {
      default: "minmax(0,1fr) auto",
      [md]: "minmax(0,1fr) auto minmax(0,1fr)",
    },
    alignItems: "center",
    rowGap: 4,
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    backgroundColor: colors.gray1,
    paddingInline: 12,
    paddingBlock: { default: 4, [md]: 0 },
    height: { default: "auto", [md]: 48 },
  },
  workspaceSwitcher: { display: "flex", minWidth: 0, alignItems: "center", gap: 6 },
  logo: {
    display: { default: "none", [sm]: "block" },
    marginRight: 4,
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: 6,
  },
  switcherLoading: {
    width: 64,
    height: 12,
    borderRadius: 4,
    backgroundColor: colors.gray4,
    animation: `${pulse} 2s infinite`,
  },
  switcherRoot: { position: "relative", minWidth: 0 },
  switcherButton: {
    display: "flex",
    height: 32,
    maxWidth: { default: 112, [sm]: 224 },
    alignItems: "center",
    gap: 8,
    borderRadius: 6,
    paddingInline: 8,
    fontWeight: 500,
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
  },
  smallInitial: {
    display: "grid",
    width: 20,
    height: 20,
    flexShrink: 0,
    placeItems: "center",
    borderRadius: 4,
    backgroundColor: colors.gray4,
    fontSize: 10,
    fontWeight: 600,
  },
  truncate: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  chevron: { width: 12, height: 12, flexShrink: 0, color: colors.gray10 },
  chevronAuto: { marginLeft: "auto" },
  popup: {
    position: { default: "fixed", [md]: "absolute" },
    left: { default: 12, [md]: 0 },
    right: { default: 12, [md]: "auto" },
    top: { default: 74, [md]: 40 },
    width: { default: "auto", [md]: 288 },
    transformOrigin: "top left",
    overflow: "hidden",
    borderRadius: 8,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray2,
    boxShadow: "0 25px 50px -12px rgb(0 0 0 / .25)",
    animationFillMode: "both",
    animationDuration: { default: "150ms", [reduce]: "1ms" },
  },
  popupShowing: { animationName: popupIn },
  popupHiding: {
    pointerEvents: "none",
    animationName: popupOut,
    animationDuration: { default: "100ms", [reduce]: "1ms" },
  },
  popupTitle: {
    padding: "10px 12px 6px",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: ".05em",
    color: colors.gray10,
  },
  teamMenu: { maxHeight: 288, overflowY: "auto", padding: "0 4px 4px" },
  teamLoading: { height: 44, paddingInline: 8 },
  menuItem: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: 8,
    borderRadius: 6,
    padding: 8,
    textAlign: "left",
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
  },
  menuInitial: {
    display: "grid",
    width: 28,
    height: 28,
    flexShrink: 0,
    placeItems: "center",
    borderRadius: 6,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray3,
    fontSize: 12,
    fontWeight: 600,
  },
  grow: { minWidth: 0, flex: 1 },
  menuName: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500,
  },
  menuMeta: { display: "block", fontSize: 10, textTransform: "capitalize", color: colors.gray10 },
  check: { width: 16, height: 16, flexShrink: 0, color: "#60a5fa" },
  menuFooter: { borderTop: `1px solid ${colors.gray5}`, padding: 4 },
  newItem: { color: { default: colors.gray11, ":hover": colors.gray12 } },
  addIconBox: {
    display: "grid",
    width: 28,
    height: 28,
    placeItems: "center",
    borderRadius: 6,
    border: `1px solid ${colors.gray6}`,
  },
  addIcon: { width: 20, height: 20, flexShrink: 0 },
  slash: { color: colors.gray8 },
  projectMenu: { maxHeight: 288, overflowY: "auto", padding: 4 },
  projectMenuTitle: {
    padding: "6px 8px",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: ".05em",
    color: colors.gray10,
  },
  projectLoading: { height: 40, paddingInline: 8 },
  noProjects: { padding: "12px 8px", fontSize: 12, color: colors.gray10 },
  mono: { fontFamily: "monospace", fontSize: 10, fontWeight: 400 },
  projectName: {
    minWidth: 0,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500,
  },
  nav: {
    gridColumn: { default: "span 2", [md]: "2" },
    gridRowStart: { default: 2, [md]: 1 },
    display: "flex",
    alignSelf: "stretch",
    justifySelf: "center",
  },
  navItem: {
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    paddingBlock: 4,
    paddingInline: { default: 10, [sm]: 16 },
    fontSize: 12,
    fontWeight: 500,
    textTransform: "capitalize",
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
  },
  navActive: { borderBottomColor: colors.focus, color: colors.gray12 },
  navIdle: {
    borderBottomColor: "transparent",
    color: { default: colors.gray10, ":hover": colors.gray12 },
  },
  account: {
    position: "relative",
    marginLeft: 12,
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    justifySelf: "end",
    gap: 8,
    gridColumnStart: { default: "auto", [md]: 3 },
  },
  main: {
    display: "flex",
    minWidth: 0,
    minHeight: 0,
    flex: 1,
    flexDirection: "column",
    backgroundColor: colors.gray2,
  },
  editor: { height: "100%", minHeight: 0 },
  hidden: { display: "none" },
});
