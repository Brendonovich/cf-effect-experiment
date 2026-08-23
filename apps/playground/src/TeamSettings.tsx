import type { TeamMember, TeamRecord } from "@macrograph/cloud-api";

import { For, Show, action, createSignal, type Component } from "solid-js";

import type { TeamsApiClient } from "./api";

import { runApi, runApiResult } from "./api";

interface TeamSettingsProps {
  readonly api: TeamsApiClient;
  readonly team: TeamRecord | undefined;
  readonly members: ReadonlyArray<TeamMember>;
  readonly onMembersChanged: () => void;
}

const AddTeamMemberForm: Component<{
  readonly onAdd: (userId: string, role: "admin" | "member") => Promise<boolean>;
  readonly canAssignAdmin: boolean;
}> = (props) => {
  const [newMemberId, setNewMemberId] = createSignal("");
  const [newMemberRole, setNewMemberRole] = createSignal<"admin" | "member">("member");

  const addTeamMember = action(async function* (event: SubmitEvent) {
    event.preventDefault();
    const userId = newMemberId().trim();
    if (userId.length === 0) return;
    const added = await props.onAdd(userId, newMemberRole());
    yield;
    if (added) setNewMemberId("");
  });

  return (
    <form class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]" onSubmit={addTeamMember}>
      <label class="sr-only" for="new-member-id">
        Macrograph user ID
      </label>
      <input
        id="new-member-id"
        class="focus-ring min-w-0 rounded-md border border-gray-6 bg-gray-1 px-3 py-2 font-mono text-xs text-gray-12 placeholder:font-sans placeholder:text-gray-9 focus:border-gray-8"
        value={newMemberId()}
        onInput={(event) => setNewMemberId(event.currentTarget.value)}
        placeholder="Macrograph user ID"
      />
      <label class="sr-only" for="new-member-role">
        Role
      </label>
      <div class="relative">
        <select
          id="new-member-role"
          class="focus-ring h-full w-full appearance-none rounded-md border border-gray-6 bg-gray-1 px-3 py-2 pr-8 text-xs text-gray-12 focus:border-gray-8"
          value={newMemberRole()}
          onChange={(event) => setNewMemberRole(event.currentTarget.value as "admin" | "member")}
        >
          <option value="member">Member</option>
          <Show when={props.canAssignAdmin}>
            <option value="admin">Admin</option>
          </Show>
        </select>
        <IconLucideChevronDown class="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-gray-10" />
      </div>
      <button class="rounded-md bg-gray-12 px-4 py-2 text-xs font-semibold text-gray-1 transition hover:bg-gray-11">
        Add member
      </button>
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
        class="grid size-8 shrink-0 place-items-center rounded border border-gray-6 bg-gray-2 text-gray-11 hover:bg-gray-3 hover:text-gray-12"
        onClick={() => dialog.showModal()}
        aria-label="Team settings"
        title="Team settings"
      >
        <IconTablerSettings class="size-4 shrink-0" />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="team-settings-title"
        class="m-auto max-h-[min(44rem,calc(100%-2rem))] w-[min(38rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-gray-6 bg-gray-2 p-0 text-sm text-gray-12 shadow-2xl backdrop:bg-black/75"
        onClick={(event) => {
          if (event.target === dialog) dialog.close();
        }}
      >
        <div class="flex items-start justify-between border-b border-gray-5 px-5 py-5 sm:px-6">
          <div class="flex min-w-0 items-center gap-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-lg border border-gray-6 bg-gray-4 text-sm font-semibold">
              {props.team?.name.slice(0, 1).toUpperCase() ?? "T"}
            </span>
            <div class="min-w-0">
              <h2 id="team-settings-title" class="truncate text-base font-semibold tracking-tight">
                {props.team?.name ?? "Team settings"}
              </h2>
              <p class="mt-0.5 text-xs text-gray-10">
                {props.team?.kind === "personal" ? "Personal team" : "Shared team"}
                <span class="px-1.5 text-gray-7">·</span>
                {roleLabel(props.team?.role ?? "member")}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="grid size-8 shrink-0 place-items-center rounded-md text-gray-10 transition hover:bg-gray-4 hover:text-gray-12"
            onClick={() => dialog.close()}
            aria-label="Close team settings"
          >
            <IconBiX class="size-4 shrink-0" />
          </button>
        </div>
        <div class="max-h-[calc(min(44rem,100vh-2rem)-5.1rem)] overflow-y-auto">
          <Show when={canManage()}>
            <section class="border-b border-gray-5 px-5 py-5 sm:px-6">
              <div class="mb-3">
                <h3 class="text-xs font-semibold text-gray-12">Add a team member</h3>
                <p class="mt-1 text-xs leading-5 text-gray-10">
                  Add someone using the user ID from their Macrograph account.
                </p>
              </div>
              <AddTeamMemberForm
                onAdd={setTeamMember}
                canAssignAdmin={props.team?.role === "owner"}
              />
            </section>
          </Show>
          <section class="px-5 py-5 sm:px-6">
            <div class="mb-3 flex items-center justify-between">
              <div>
                <h3 class="text-xs font-semibold text-gray-12">Members</h3>
                <p class="mt-1 text-xs text-gray-10">
                  People with access to this team and its projects.
                </p>
              </div>
              <span class="rounded-full border border-gray-6 bg-gray-3 px-2 py-0.5 text-[10px] font-medium text-gray-11">
                {props.members.length}
              </span>
            </div>
            <div class="divide-y divide-gray-5 overflow-hidden rounded-lg border border-gray-5 bg-gray-1">
              <For
                each={props.members}
                fallback={
                  <p class="px-4 py-6 text-center text-xs text-gray-10">No members found</p>
                }
              >
                {(member) => (
                  <div class="flex min-h-14 items-center gap-3 px-3 py-2.5 sm:px-4">
                    <span class="grid size-8 shrink-0 place-items-center rounded-full bg-gray-4 font-mono text-[10px] font-semibold text-gray-11">
                      {member.userId.slice(0, 2).toUpperCase()}
                    </span>
                    <div class="min-w-0 flex-1">
                      <span class="block truncate font-mono text-xs text-gray-12">
                        {member.userId}
                      </span>
                    </div>
                    <Show
                      when={canManageMember(member)}
                      fallback={
                        <span class="rounded-full bg-gray-3 px-2 py-1 text-[10px] font-medium text-gray-11">
                          {roleLabel(member.role)}
                        </span>
                      }
                    >
                      <div class="relative">
                        <select
                          aria-label={`Role for ${member.userId}`}
                          class="focus-ring appearance-none rounded-md border border-gray-6 bg-gray-2 py-1.5 pl-2.5 pr-7 text-[11px] text-gray-12 focus:border-gray-8"
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
                        <IconLucideChevronDown class="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-gray-10" />
                      </div>
                      <button
                        type="button"
                        class="grid size-8 shrink-0 place-items-center rounded-md text-gray-9 transition hover:bg-red-3 hover:text-red-11"
                        onClick={() => void removeTeamMember(member.userId)}
                        aria-label={`Remove ${member.userId}`}
                        title="Remove member"
                      >
                        <IconBiX class="size-3.5 shrink-0" />
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
