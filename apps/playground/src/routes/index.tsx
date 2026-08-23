import { useNavigate } from "@solidjs/router";
import { For, Loading, createMemo, createSignal, refresh, resolve } from "solid-js";

import { runApi } from "../api";
import { useWorkspace } from "../App";
import { CreateProjectDialog } from "../CreateProjectForm";
import { LoadingState } from "../LoadingState";

export const WorkspaceHomeRoute = () => {
  const workspace = useWorkspace();
  const navigate = useNavigate();

  return (
    <div class="h-full overflow-y-auto bg-gray-2">
      <div class="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <div class="mb-8">
          <h1 class="text-2xl font-semibold tracking-tight text-gray-12">Teams and projects</h1>
          <p class="mt-2 max-w-xl text-sm leading-6 text-gray-10">
            Choose a project to open its graphs.
          </p>
        </div>

        <Loading fallback={<LoadingState label="Loading teams and projects" class="h-48" />}>
          <div class="space-y-5">
            <For
              each={workspace.teams()}
              fallback={
                <div class="rounded-xl border border-dashed border-gray-6 bg-gray-1 px-6 py-14 text-center">
                  <p class="font-medium text-gray-12">No teams available</p>
                  <p class="mt-1 text-sm text-gray-10">Create or join a team to start a project.</p>
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
                  <section class="overflow-hidden rounded-xl border border-gray-6 bg-gray-1 shadow-sm">
                    <div class="flex w-full items-center gap-3 border-b border-gray-5 px-4 py-3 text-left sm:px-5">
                      <span class="grid size-9 shrink-0 place-items-center rounded-lg border border-gray-6 bg-gray-3 text-sm font-semibold text-gray-12">
                        {team.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-semibold text-gray-12">{team.name}</span>
                        <span class="block text-xs capitalize text-gray-9">{team.kind} team</span>
                      </span>
                      <span class="text-xs text-gray-9">
                        {teamProjects().length}{" "}
                        {teamProjects().length === 1 ? "project" : "projects"}
                      </span>
                    </div>

                    <div class="grid gap-px bg-gray-5 sm:grid-cols-2">
                      <For
                        each={teamProjects()}
                        fallback={
                          <div class="bg-gray-1 px-5 py-6 text-sm text-gray-10 sm:col-span-2">
                            <div class="flex items-center justify-between gap-4">
                              <span>No projects yet.</span>
                              <button
                                type="button"
                                class="shrink-0 rounded-md bg-gray-12 px-3 py-2 text-xs font-semibold text-gray-1 transition hover:bg-gray-11"
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
                                onCreated={async (project) => {
                                  refresh(workspace.projects);
                                  await resolve(workspace.projects);
                                  navigate(
                                    `/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}/editor/graphs`,
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
                            class="group flex min-w-0 items-center gap-3 bg-gray-1 px-4 py-4 text-left transition hover:bg-gray-2 sm:px-5 sm:[&:last-child:nth-child(odd)]:col-span-2"
                            onClick={() =>
                              navigate(
                                `${teamPath}/projects/${encodeURIComponent(project.id)}/editor/graphs`,
                              )
                            }
                          >
                            <span class="grid size-9 shrink-0 place-items-center rounded-md bg-gray-3 font-mono text-[10px] font-semibold text-gray-11 ring-1 ring-gray-6 transition group-hover:bg-gray-4">
                              {project.name.slice(0, 2).toUpperCase()}
                            </span>
                            <span class="min-w-0 flex-1">
                              <span class="block truncate font-medium text-gray-12">
                                {project.name}
                              </span>
                            </span>
                            <span class="text-gray-8 transition group-hover:translate-x-0.5 group-hover:text-gray-11">
                              &rarr;
                            </span>
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
      </div>
    </div>
  );
};
