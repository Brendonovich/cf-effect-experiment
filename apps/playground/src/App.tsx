import type {
	ProjectRecord,
	SessionStatus,
	TeamMember,
	TeamRecord,
} from "@macrograph/cloud-api";

import {
	useNavigate,
	useParams,
	useRouteMatches,
	type RouteSectionProps,
} from "@solidjs/router";
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
	useContext,
} from "solid-js";

import type { ApiClient } from "./api";

import { makeApiClient, runApi } from "./api";
import { createPresence } from "./createPresence";
import { CreateProjectForm } from "./CreateProjectForm";
import { LoadingState } from "./LoadingState";
import { Playground } from "./routes/teams/projects/editor/Playground";
import { TeamSettings } from "./TeamSettings";

const storedSessionId = () => {
	const stored = localStorage.getItem("macrograph:sessionId");
	if (stored !== null) return stored;
	const created = crypto.randomUUID();
	localStorage.setItem("macrograph:sessionId", created);
	return created;
};
const publicRuntimeOrigin = () =>
	new URL(
		"/runtime",
		import.meta.env.VITE_PUBLIC_RUNTIME_ORIGIN ??
			import.meta.env.VITE_WORKER_URL ??
			location.origin,
	).href;

const sleep = (duration: number) =>
	new Promise((resolve) => setTimeout(resolve, duration));
const editorTab = (value: string): "rpcs" | "graphs" | "plugin" =>
	value === "rpcs" || value === "plugin" ? value : "graphs";

interface WorkspaceContextValue {
	readonly api: ApiClient;
	readonly projects: () => ReadonlyArray<ProjectRecord>;
	readonly selectedProject: () => ProjectRecord | undefined;
	readonly selectedTeam: () => TeamRecord | undefined;
	readonly teamMembers: () => ReadonlyArray<TeamMember>;
	readonly editorUrl: (projectId: string) => string;
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
		editorTab?: string;
		graphId?: string;
		revisionId?: string;
		ingestEventId?: string;
	}>();
	const sessionId = storedSessionId();
	const api = makeApiClient(sessionId, publicRuntimeOrigin());
	const [teamSwitcherOpen, setTeamSwitcherOpen] = createSignal(false);
	const [projectSwitcherOpen, setProjectSwitcherOpen] = createSignal(false);
	const [createProjectOpen, setCreateProjectOpen] = createSignal(false);
	const [teamSwitcherPopup, setTeamSwitcherPopup] =
		createSignal<HTMLDivElement | null>(null);
	const [projectSwitcherPopup, setProjectSwitcherPopup] =
		createSignal<HTMLDivElement | null>(null);
	const [createProjectForm, setCreateProjectForm] =
		createSignal<HTMLDivElement | null>(null);
	const teamSwitcherPresence = createPresence({
		show: teamSwitcherOpen,
		element: teamSwitcherPopup,
	});
	const projectSwitcherPresence = createPresence({
		show: projectSwitcherOpen,
		element: projectSwitcherPopup,
	});
	const createProjectPresence = createPresence({
		show: createProjectOpen,
		element: createProjectForm,
	});
	let workspaceSwitcher: HTMLDivElement | undefined;

	onSettled(() => {
		const closeOnOutsideClick = (event: PointerEvent) => {
			if (!workspaceSwitcher?.contains(event.target as globalThis.Node)) {
				setTeamSwitcherOpen(false);
				setProjectSwitcherOpen(false);
				setCreateProjectOpen(false);
			}
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setTeamSwitcherOpen(false);
			setProjectSwitcherOpen(false);
			setCreateProjectOpen(false);
		};
		window.addEventListener("pointerdown", closeOnOutsideClick);
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			window.removeEventListener("pointerdown", closeOnOutsideClick);
			window.removeEventListener("keydown", closeOnEscape);
		};
	});

	const params = () => routeParams;
	const [editorProjectId, setEditorProjectId] = createSignal(
		params().editorTab === undefined ? undefined : params().projectId,
	);
	const [activeEditorTab, setActiveEditorTab] = createSignal(
		editorTab(params().editorTab ?? "graphs"),
	);
	const [activeEditorGraphId, setActiveEditorGraphId] = createSignal(
		params().graphId,
	);
	createEffect(
		() => ({
			editorTab: params().editorTab,
			graphId: params().graphId,
			projectId: params().projectId,
		}),
		(route) => {
			if (route.projectId === undefined) {
				setEditorProjectId(undefined);
				return;
			}
			if (route.editorTab === undefined) {
				if (editorProjectId() !== route.projectId)
					setEditorProjectId(undefined);
				return;
			}
			setEditorProjectId(route.projectId);
			setActiveEditorTab(editorTab(route.editorTab));
			setActiveEditorGraphId(route.graphId);
		},
	);
	const editorVisible = () =>
		params().editorTab !== undefined &&
		editorProjectId() === params().projectId;

	const cloudAuth = createMemo<SessionStatus | undefined>(async function* () {
		const headers = { authorization: `Bearer ${sessionId}` };
		let state = await runApi(api.session.get({ headers }));
		if (state === undefined) {
			yield { state: "disconnected" };
			return;
		}
		if (state.state === "pending") {
			state = (await runApi(api.session.poll({ headers }))) ?? state;
		}
		yield state;
		while (state.state === "pending") {
			await sleep(2000);
			const next = await runApi(api.session.poll({ headers }));
			if (next === undefined) continue;
			state = next;
			yield state;
		}
	});

	const teams = createMemo(async () => {
		if (cloudAuth()?.state !== "connected") return [];
		return (await runApi(api.teams.list()))?.teams ?? [];
	});

	const projects = createMemo(async () => {
		if (cloudAuth()?.state !== "connected") return [];
		return (await runApi(api.projects.list()))?.projects ?? [];
	});

	const selectedProject = createMemo(() =>
		projects().find(
			(project) =>
				project.id === params().projectId && project.teamId === params().teamId,
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
		const teamId = selectedTeamId();
		if (cloudAuth()?.state !== "connected" || teamId === undefined) return [];
		return (
			(await runApi(api.teams.listMembers({ params: { teamId } })))?.members ??
			[]
		);
	});

	const connectedUserEmail = createMemo(() => {
		const auth = cloudAuth();
		return auth?.state === "connected" ? auth.email : "";
	});

	const redirectToLogin = action(async function* () {
		const current = cloudAuth();
		const next =
			current?.state === "pending"
				? current
				: await runApi(
						api.session.start({
							headers: { authorization: `Bearer ${sessionId}` },
						}),
					);
		yield;
		if (next?.state === "pending")
			navigate(next.verificationUrl, { replace: true });
	});

	createEffect(cloudAuth, (auth) => {
		if (auth?.state !== "connected") void redirectToLogin();
	});

	const disconnectCloud = action(async function* () {
		yield runApi(
			api.session.disconnect({
				headers: { authorization: `Bearer ${sessionId}` },
			}),
		);
		refresh(cloudAuth);
		refresh(teams);
		refresh(projects);
		navigate("/", { replace: true });
	});

	const visibleProjects = () =>
		projects().filter((project) => project.teamId === selectedTeamId());
	const workspaceView = () => matches().at(-1)?.route.info?.workspaceView;
	const openWorkspaceView = (
		view: "editor" | "revisions" | "events" | "settings",
	) => {
		const project = selectedProject();
		if (project === undefined) return;
		const projectPath = `/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}`;
		if (view === "editor") navigate(`${projectPath}/editor/graphs`);
		else if (view === "revisions")
			navigate(
				`${projectPath}/revisions${project.currentRevisionId === null ? "" : `/${encodeURIComponent(project.currentRevisionId)}`}`,
			);
		else navigate(`${projectPath}/${view}`);
	};
	const editorUrl = (projectId: string) => {
		const url = new URL("/rpc", window.location.origin);
		url.searchParams.set("projectId", projectId);
		url.searchParams.set("sessionId", sessionId);
		url.searchParams.set("publicOrigin", publicRuntimeOrigin());
		return url.href;
	};

	const workspace: WorkspaceContextValue = {
		api,
		projects,
		selectedProject,
		selectedTeam,
		teamMembers,
		editorUrl,
	};

	return (
		<WorkspaceContext value={workspace}>
			<div class="dark dark-theme flex h-screen w-screen flex-col overflow-hidden bg-gray-1 text-sm text-gray-12 [color-scheme:dark]">
				<header class="relative z-40 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-y-1 border-b border-gray-5 bg-gray-1 px-3 py-1 md:h-12 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:py-0">
					<div
						ref={workspaceSwitcher}
						class="flex min-w-0 items-center gap-1.5"
					>
						<div class="mr-1 hidden size-7 shrink-0 place-items-center rounded-md bg-gray-12 text-[10px] font-black tracking-tight text-gray-1 sm:grid">
							MG
						</div>
						<Loading
							fallback={
								<span class="h-3 w-16 animate-pulse rounded bg-gray-4" />
							}
						>
							<div class="relative min-w-0">
								<button
									type="button"
									class="flex h-8 max-w-28 items-center gap-2 rounded-md px-2 font-medium hover:bg-gray-3 sm:max-w-56"
									aria-haspopup="menu"
									aria-expanded={teamSwitcherOpen()}
									onClick={() => {
										setTeamSwitcherOpen((open) => !open);
										setProjectSwitcherOpen(false);
										setCreateProjectOpen(false);
									}}
								>
									<span class="grid size-5 shrink-0 place-items-center rounded bg-gray-4 text-[10px] font-semibold">
										{selectedTeam()?.name.slice(0, 1).toUpperCase() ?? "T"}
									</span>
									<span class="truncate">
										{selectedTeam()?.name ?? "Select team"}
									</span>
									<IconLucideChevronDown class="ml-auto size-3 shrink-0 text-gray-10" />
								</button>
								<Show when={teamSwitcherPresence.present()}>
									<div
										ref={setTeamSwitcherPopup}
										class={`fixed left-3 right-3 top-[4.625rem] origin-top-left overflow-hidden rounded-lg border border-gray-6 bg-gray-2 p-1 shadow-2xl motion-reduce:duration-1 md:absolute md:left-0 md:right-auto md:top-10 md:w-72 ${
											teamSwitcherPresence.state() === "hiding"
												? "pointer-events-none animate-out fade-out-0 zoom-out-95 slide-out-to-top-1 duration-100"
												: "animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
										}`}
									>
										<div class="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-10">
											Teams
										</div>
										<Loading
											fallback={
												<LoadingState label="Loading teams" class="h-11 px-2" />
											}
										>
											<For each={teams()}>
												{(team) => (
													<button
														type="button"
														role="menuitem"
														class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-gray-4"
														onClick={() => {
															const firstProject = projects().find(
																(project) => project.teamId === team.id,
															);
															setTeamSwitcherOpen(false);
															navigate(
																firstProject === undefined
																	? `/teams/${encodeURIComponent(team.id)}`
																	: `/teams/${encodeURIComponent(team.id)}/projects/${encodeURIComponent(firstProject.id)}/editor/graphs`,
															);
														}}
													>
														<span class="grid size-7 shrink-0 place-items-center rounded-md border border-gray-6 bg-gray-3 text-xs font-semibold">
															{team.name.slice(0, 1).toUpperCase()}
														</span>
														<span class="min-w-0 flex-1">
															<span class="block truncate font-medium">
																{team.name}
															</span>
															<span class="block text-[10px] capitalize text-gray-10">
																{team.role}
															</span>
														</span>
														<Show when={team.id === selectedTeamId()}>
															<IconTablerCheck class="size-4 shrink-0 text-blue-400" />
														</Show>
													</button>
												)}
											</For>
										</Loading>
									</div>
								</Show>
							</div>
							<span class="text-gray-8">/</span>
							<div class="relative min-w-0">
								<button
									type="button"
									class="flex h-8 max-w-28 items-center gap-2 rounded-md px-2 font-medium hover:bg-gray-3 sm:max-w-56"
									aria-haspopup="menu"
									aria-expanded={projectSwitcherOpen()}
									onClick={() => {
										setProjectSwitcherOpen((open) => !open);
										setTeamSwitcherOpen(false);
										setCreateProjectOpen(false);
									}}
								>
									<span class="truncate">
										{selectedProject()?.name ?? "Select project"}
									</span>
									<IconLucideChevronDown class="size-3 shrink-0 text-gray-10" />
								</button>
								<Show when={projectSwitcherPresence.present()}>
									<div
										ref={setProjectSwitcherPopup}
										class={`fixed left-3 right-3 top-[4.625rem] origin-top-left overflow-hidden rounded-lg border border-gray-6 bg-gray-2 shadow-2xl motion-reduce:duration-1 md:absolute md:left-0 md:right-auto md:top-10 md:w-72 ${
											projectSwitcherPresence.state() === "hiding"
												? "pointer-events-none animate-out fade-out-0 zoom-out-95 slide-out-to-top-1 duration-100"
												: "animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
										}`}
									>
										<div class="max-h-72 overflow-y-auto p-1">
											<div class="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-10">
												Projects
											</div>
											<Loading
												fallback={
													<LoadingState
														label="Loading projects"
														class="h-10 px-2"
													/>
												}
											>
												<For
													each={visibleProjects()}
													fallback={
														<div class="px-2 py-3 text-xs text-gray-10">
															No projects yet
														</div>
													}
												>
													{(project) => (
														<button
															type="button"
															role="menuitem"
															class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-gray-4"
															onClick={() => {
																setProjectSwitcherOpen(false);
																navigate(
																	`/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}/editor/graphs`,
																);
															}}
														>
															<span class="grid size-7 shrink-0 place-items-center rounded-md border border-gray-6 bg-gray-3 font-mono text-[10px]">
																{project.name.slice(0, 2).toUpperCase()}
															</span>
															<span class="min-w-0 flex-1 truncate font-medium">
																{project.name}
															</span>
															<Show when={project.id === params().projectId}>
																<IconTablerCheck class="size-4 shrink-0 text-blue-400" />
															</Show>
														</button>
													)}
												</For>
											</Loading>
										</div>
										<div class="border-t border-gray-5 p-1">
											<button
												type="button"
												class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-gray-11 hover:bg-gray-4 hover:text-gray-12"
												onClick={() => setCreateProjectOpen((open) => !open)}
											>
												<span class="grid size-7 place-items-center rounded-md border border-gray-6">
													<IconMaterialSymbolsAddRounded class="size-5 shrink-0" />
												</span>
												New project
											</button>
											<Show when={createProjectPresence.present()}>
												<div
													ref={setCreateProjectForm}
													class={`mt-1 origin-top-left overflow-hidden rounded-md border border-gray-6 bg-gray-1 motion-reduce:duration-1 ${
														createProjectPresence.state() === "hiding"
															? "pointer-events-none animate-out fade-out-0 zoom-out-95 slide-out-to-top-1 duration-100"
															: "animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
													}`}
												>
													<Loading
														fallback={
															<LoadingState
																label="Loading team members"
																class="h-[122px]"
															/>
														}
													>
														<CreateProjectForm
															api={api.projects}
															teamId={selectedTeamId()}
															members={teamMembers()}
															onCreated={(project) => {
																setCreateProjectOpen(false);
																setProjectSwitcherOpen(false);
																refresh(projects);
																navigate(
																	`/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}/editor/graphs`,
																);
															}}
														/>
													</Loading>
												</div>
											</Show>
										</div>
									</div>
								</Show>
							</div>
							<TeamSettings
								api={api.teams}
								team={selectedTeam()}
								members={teamMembers()}
								onTeamCreated={(teamId) => {
									refresh(teams);
									navigate(`/teams/${encodeURIComponent(teamId)}`);
								}}
								onMembersChanged={() => refresh(teamMembers)}
							/>
						</Loading>
					</div>
					<Show when={params().projectId !== undefined}>
						<nav class="col-span-2 row-start-2 flex justify-self-center rounded-md bg-gray-3 p-0.5 md:col-span-1 md:col-start-2 md:row-start-1">
							<For
								each={["editor", "revisions", "events", "settings"] as const}
							>
								{(view) => (
									<button
										type="button"
										class={`rounded px-2 py-1 text-xs font-medium capitalize transition sm:px-3 ${
											workspaceView() === view
												? "bg-gray-5 text-gray-12 shadow-sm"
												: "text-gray-11 hover:text-gray-12"
										}`}
										onClick={() => openWorkspaceView(view)}
									>
										{view}
									</button>
								)}
							</For>
						</nav>
					</Show>
					<div class="ml-3 flex min-w-0 items-center justify-self-end gap-2 md:col-start-3">
						<Loading fallback={null}>
							<span class="hidden max-w-48 truncate text-xs text-gray-10 lg:block">
								{connectedUserEmail()}
							</span>
						</Loading>
						<button
							class="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-gray-11 hover:bg-gray-3 hover:text-gray-12"
							onClick={() => void disconnectCloud()}
						>
							Log out
						</button>
					</div>
				</header>
				<main class="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-1">
					<Show when={editorProjectId()} keyed>
						{(projectId) => (
							<div class={editorVisible() ? "h-full min-h-0" : "hidden"}>
								<Playground
									wsUrl={editorUrl(projectId)}
									activeTab={activeEditorTab()}
									selectedGraphId={activeEditorGraphId()}
									onSelectionChange={(tab, graphId, replace) => {
										const teamId = params().teamId;
										if (!editorVisible() || teamId === undefined) return;
										navigate(
											`/teams/${encodeURIComponent(teamId)}/projects/${encodeURIComponent(projectId)}/editor/${tab}${graphId === undefined ? "" : `/${encodeURIComponent(graphId)}`}`,
											replace === undefined ? undefined : { replace },
										);
									}}
								/>
							</div>
						)}
					</Show>
					<Show when={!editorVisible()}>{props.children}</Show>
				</main>
			</div>
		</WorkspaceContext>
	);
}
