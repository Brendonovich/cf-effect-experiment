import type { ProjectRecord, TeamMember } from "@macrograph/cloud-api";

import { For, Show, action, createSignal, type Component } from "solid-js";

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

export const CreateProjectDialog: Component<CreateProjectDialogProps> = (props) => {
  const [newProjectName, setNewProjectName] = createSignal("");
  const [newProjectAccess, setNewProjectAccess] = createSignal<"team" | "restricted">("team");
  const [newProjectUserIds, setNewProjectUserIds] = createSignal<string[]>([]);
  let dialog!: HTMLDialogElement;

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
    setNewProjectName("");
    setNewProjectAccess("team");
    setNewProjectUserIds([]);
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
      class="m-auto max-h-[calc(100vh-1.5rem)] w-[min(34rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-gray-6 bg-gray-2 p-0 text-sm text-gray-12 shadow-2xl backdrop:bg-black/75"
      onClick={(event) => {
        if (event.target === dialog) dialog.close();
      }}
    >
      <div class="flex items-start justify-between border-b border-gray-5 px-5 py-5 sm:px-6">
        <div>
          <h2 id="create-project-title" class="text-base font-semibold tracking-tight">
            Create a new project
          </h2>
          <p class="mt-1 text-xs leading-5 text-gray-10">Choose who on the team can access it.</p>
        </div>
        <button
          type="button"
          class="grid size-8 shrink-0 place-items-center rounded-md text-gray-10 transition hover:bg-gray-4 hover:text-gray-12"
          onClick={() => dialog.close()}
          aria-label="Close create project dialog"
        >
          <IconBiX class="size-4 shrink-0" />
        </button>
      </div>
      <form class="max-h-[calc(100vh-7rem)] overflow-y-auto p-5 sm:p-6" onSubmit={createProject}>
        <label for="new-project-name" class="mb-2 block text-xs font-medium text-gray-11">
          Project name
        </label>
        <input
          id="new-project-name"
          class="focus-ring w-full rounded-md border border-gray-6 bg-gray-1 px-3 py-2.5 text-sm text-gray-12 placeholder:text-gray-9 focus:border-gray-8"
          value={newProjectName()}
          onInput={(event) => setNewProjectName(event.currentTarget.value)}
          placeholder="My project"
          autofocus
        />
        <label for="new-project-access" class="mb-2 mt-5 block text-xs font-medium text-gray-11">
          Access
        </label>
        <div class="relative">
          <select
            id="new-project-access"
            class="focus-ring w-full appearance-none rounded-md border border-gray-6 bg-gray-1 px-3 py-2.5 pr-9 text-sm text-gray-12 focus:border-gray-8"
            value={newProjectAccess()}
            onChange={(event) =>
              setNewProjectAccess(event.currentTarget.value as "team" | "restricted")
            }
          >
            <option value="team">Everyone in team</option>
            <option value="restricted">Specific members</option>
          </select>
          <IconLucideChevronDown class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-10" />
        </div>
        <Show when={newProjectAccess() === "restricted"}>
          <div class="mt-3 max-h-48 divide-y divide-gray-5 overflow-y-auto rounded-md border border-gray-5 bg-gray-1">
            <For each={props.members}>
              {(member) => (
                <label class="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-2">
                  <input
                    type="checkbox"
                    checked={newProjectUserIds().includes(member.userId)}
                    onChange={() => toggleUser(member.userId)}
                  />
                  <span class="min-w-0 flex-1 truncate font-mono text-xs">{member.userId}</span>
                  <span class="text-[10px] capitalize text-gray-10">{member.role}</span>
                </label>
              )}
            </For>
          </div>
        </Show>
        <div class="mt-6 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md px-3.5 py-2 text-xs font-medium text-gray-11 transition hover:bg-gray-4 hover:text-gray-12"
            onClick={() => dialog.close()}
          >
            Cancel
          </button>
          <button class="rounded-md bg-gray-12 px-4 py-2 text-xs font-semibold text-gray-1 transition hover:bg-gray-11">
            Create project
          </button>
        </div>
      </form>
    </dialog>
  );
};
