import type { ProjectRecord, TeamMember } from "@macrograph/cloud-api";

import { For, Show, action, createSignal, type Component } from "solid-js";

import type { ProjectsApiClient } from "./api";

import { runApi } from "./api";

interface CreateProjectFormProps {
  readonly api: ProjectsApiClient;
  readonly teamId: string | undefined;
  readonly members: ReadonlyArray<TeamMember>;
  readonly onCreated: (project: ProjectRecord) => void;
}

export const CreateProjectForm: Component<CreateProjectFormProps> = (props) => {
  const [newProjectName, setNewProjectName] = createSignal("");
  const [newProjectAccess, setNewProjectAccess] = createSignal<"team" | "restricted">("team");
  const [newProjectUserIds, setNewProjectUserIds] = createSignal<string[]>([]);

  const toggleUser = (userId: string) =>
    setNewProjectUserIds((userIds) =>
      userIds.includes(userId)
        ? userIds.filter((candidate) => candidate !== userId)
        : [...userIds, userId],
    );

  const createProject = action(async function* (event: SubmitEvent) {
    event.preventDefault();
    const name = newProjectName().trim();
    if (name.length === 0) return;
    const body = await runApi(
      props.api.create({
        payload: {
          name,
          teamId: props.teamId,
          access: newProjectAccess(),
          userIds: newProjectAccess() === "restricted" ? newProjectUserIds() : [],
        },
      }),
    );
    yield;
    if (body === undefined) return;
    props.onCreated(body.project);
    setNewProjectName("");
    setNewProjectAccess("team");
    setNewProjectUserIds([]);
  });

  return (
    <form class="p-2.5" onSubmit={createProject}>
      <input
        class="w-full rounded border border-gray-6 bg-gray-2 px-2 py-1.5 text-xs text-gray-12 outline-none focus:border-blue-500"
        value={newProjectName()}
        onInput={(event) => setNewProjectName(event.currentTarget.value)}
        placeholder="New project name"
        autofocus
      />
      <select
        class="mt-1.5 w-full rounded border border-gray-6 bg-gray-2 px-2 py-1.5 text-xs text-gray-12"
        value={newProjectAccess()}
        onChange={(event) =>
          setNewProjectAccess(event.currentTarget.value as "team" | "restricted")
        }
      >
        <option value="team">Everyone in team</option>
        <option value="restricted">Specific users</option>
      </select>
      <Show when={newProjectAccess() === "restricted"}>
        <div class="mt-2 max-h-24 space-y-1 overflow-y-auto rounded border border-gray-5 p-2">
          <For each={props.members}>
            {(member) => (
              <label class="flex items-center gap-2 text-[10px]">
                <input
                  type="checkbox"
                  checked={newProjectUserIds().includes(member.userId)}
                  onChange={() => toggleUser(member.userId)}
                />
                <span class="truncate font-mono">{member.userId}</span>
              </label>
            )}
          </For>
        </div>
      </Show>
      <button class="mt-2 w-full rounded bg-gray-12 px-3 py-1.5 text-xs font-semibold text-gray-1 hover:bg-gray-11">
        Create project
      </button>
    </form>
  );
};
