import { createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  For,
  Show,
  Loading,
  action,
  createOptimisticStore,
  refresh,
  resolve,
} from "solid-js";

import { runApi } from "../../../../api";
import { useWorkspace } from "../../../../App";
import { LoadingState } from "../../../../LoadingState";
import { useProject } from "../layout";

export const ProjectSettingsRoute = () => {
  const workspace = useWorkspace();
  const route = useProject();
  const queryClient = useQueryClient();
  const canManage = () => {
    const role = workspace.selectedTeam()?.role;
    return role === "owner" || role === "admin";
  };
  const projectAccessKey = ["project-access", route.projectId] as const;
  const projectAccessQuery = createQuery(() => ({
    queryKey: projectAccessKey,
    queryFn: async () => {
      const body = await runApi(
        workspace.api.projects.getAccess({ params: { projectId: route.projectId } }),
      );
      if (body === undefined) throw new Error("Could not load project access");
      return body;
    },
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  }));
  const [optimisticAccess, setOptimisticAccess] = createOptimisticStore(
    () => ({
      access: projectAccessQuery.data?.access ?? "team",
      userIds: [...(projectAccessQuery.data?.userIds ?? [])],
    }),
    { access: "team" as "team" | "restricted", userIds: [] as string[] },
  );

  const saveAccess = action(async function* (
    access: "team" | "restricted",
    userIds: ReadonlyArray<string> = optimisticAccess.userIds,
  ) {
    setOptimisticAccess((draft) => {
      draft.access = access;
      draft.userIds = [...userIds];
    });
    const result = await runApi(
      workspace.api.projects.setAccess({
        params: { projectId: route.projectId },
        payload: { access, userIds },
      }),
    );
    if (result === undefined) throw new Error("Could not update project access");
    yield;
    queryClient.setQueryData(projectAccessKey, { access, userIds: [...result.userIds] });
    refresh(workspace.projects);
    yield resolve(workspace.projects);
  });

  return (
    <div class="h-full overflow-y-auto bg-gray-2 p-6 md:p-10">
      <div class="mx-auto max-w-2xl">
        <div class="mb-6">
          <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-11">
            Project settings
          </div>
          <Loading fallback={<div class="mt-1 h-7 w-40 animate-pulse rounded bg-gray-4" />}>
            <h1 class="mt-1 text-xl font-semibold text-gray-12">{route.project()?.name}</h1>
          </Loading>
        </div>
        <section class="rounded-lg border border-gray-5 bg-gray-1">
          <div class="border-b border-gray-5 px-5 py-4">
            <h2 class="font-semibold text-gray-12">Access</h2>
            <p class="mt-1 text-xs text-gray-11">
              Choose who in this team can open and manage this project.
            </p>
          </div>
          <Loading fallback={<LoadingState label="Loading permissions" class="h-[104px]" />}>
            <Show
              when={canManage()}
              fallback={
                <p class="px-5 py-4 text-sm text-gray-11">
                  Only team owners and admins can change project access.
                </p>
              }
            >
              <div class="space-y-5 p-5">
                <Show
                  when={!projectAccessQuery.isPending}
                  fallback={<LoadingState label="Loading project access" class="h-16" />}
                >
                  <div class="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      class={`rounded-md border px-4 py-3 text-left ${optimisticAccess.access === "team" ? "border-blue-500 bg-blue-500/10 text-gray-12" : "border-gray-6 bg-gray-2 text-gray-11 hover:border-gray-7"}`}
                      onClick={() => void saveAccess("team", []).catch(() => undefined)}
                    >
                      <div class="font-medium">Everyone on the team</div>
                      <div class="mt-1 text-xs opacity-75">All team members have access.</div>
                    </button>
                    <button
                      type="button"
                      class={`rounded-md border px-4 py-3 text-left ${optimisticAccess.access === "restricted" ? "border-blue-500 bg-blue-500/10 text-gray-12" : "border-gray-6 bg-gray-2 text-gray-11 hover:border-gray-7"}`}
                      onClick={() => void saveAccess("restricted").catch(() => undefined)}
                    >
                      <div class="font-medium">Specific people</div>
                      <div class="mt-1 text-xs opacity-75">Only selected members have access.</div>
                    </button>
                  </div>
                </Show>
                <Show when={!projectAccessQuery.isPending} fallback={null}>
                  <Show when={optimisticAccess.access === "restricted"}>
                    <div>
                      <div class="mb-2 text-xs font-medium text-gray-11">Team members</div>
                      <div class="divide-y divide-gray-5 rounded-md border border-gray-5">
                        <Loading
                          fallback={<LoadingState label="Loading team members" class="h-9" />}
                        >
                          <For each={workspace.teamMembers()}>
                            {(member) => (
                              <label class="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-2">
                                <input
                                  type="checkbox"
                                  checked={optimisticAccess.userIds.includes(member.userId)}
                                  onChange={() => {
                                    const userIds = optimisticAccess.userIds.includes(member.userId)
                                      ? optimisticAccess.userIds.filter(
                                          (userId) => userId !== member.userId,
                                        )
                                      : [...optimisticAccess.userIds, member.userId];
                                    void saveAccess("restricted", userIds).catch(() => undefined);
                                  }}
                                />
                                <span class="min-w-0 flex-1 truncate font-mono text-xs text-gray-12">
                                  {member.userId}
                                </span>
                                <span class="text-[10px] uppercase tracking-wide text-gray-11">
                                  {member.role}
                                </span>
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
      </div>
    </div>
  );
};
