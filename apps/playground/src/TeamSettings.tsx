import type { TeamMember, TeamRecord } from "@macrograph/cloud-api";

import { For, Show, action, createSignal, type Component } from "solid-js";

import type { TeamsApiClient } from "./api";

import { runApi, runApiResult } from "./api";

interface TeamSettingsProps {
  readonly api: TeamsApiClient;
  readonly team: TeamRecord | undefined;
  readonly members: ReadonlyArray<TeamMember>;
  readonly onTeamCreated: (teamId: string) => void;
  readonly onMembersChanged: () => void;
}

const CreateTeamForm: Component<{
  readonly api: TeamsApiClient;
  readonly onCreated: (teamId: string) => void;
}> = (props) => {
  const [newTeamName, setNewTeamName] = createSignal("");

  const createTeam = action(async function* (event: SubmitEvent) {
    event.preventDefault();
    const name = newTeamName().trim();
    if (name.length === 0) return;
    const body = await runApi(props.api.create({ payload: { name } }));
    yield;
    if (body === undefined) return;
    props.onCreated(body.team.id);
    setNewTeamName("");
  });

  return (
    <form class="mt-3 flex gap-1" onSubmit={createTeam}>
      <input
        class="min-w-0 flex-1 rounded border border-gray-6 bg-gray-1 px-2 py-1"
        value={newTeamName()}
        onInput={(event) => setNewTeamName(event.currentTarget.value)}
        placeholder="New team"
      />
      <button class="rounded bg-gray-5 px-2 font-medium">Create</button>
    </form>
  );
};

const AddTeamMemberForm: Component<{
  readonly onAdd: (userId: string, role: "admin" | "member") => Promise<boolean>;
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
    <form class="mt-3 space-y-1.5" onSubmit={addTeamMember}>
      <input
        class="w-full rounded border border-gray-6 bg-gray-1 px-2 py-1 font-mono text-[10px]"
        value={newMemberId()}
        onInput={(event) => setNewMemberId(event.currentTarget.value)}
        placeholder="Macrograph user ID"
      />
      <div class="flex gap-1">
        <select
          class="min-w-0 flex-1 rounded border border-gray-6 bg-gray-1 px-1 py-1"
          value={newMemberRole()}
          onChange={(event) => setNewMemberRole(event.currentTarget.value as "admin" | "member")}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button class="rounded bg-gray-5 px-2 font-medium">Add</button>
      </div>
    </form>
  );
};

export const TeamSettings: Component<TeamSettingsProps> = (props) => {
  let dialog!: HTMLDialogElement;
  const canManage = () => props.team?.role === "owner" || props.team?.role === "admin";

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
        class="m-auto w-[min(28rem,calc(100%-2rem))] rounded-lg border border-gray-6 bg-gray-2 p-0 text-xs text-gray-12 shadow-2xl backdrop:bg-black/70"
      >
        <div class="flex items-center justify-between border-b border-gray-5 px-4 py-3">
          <h2 id="team-settings-title" class="text-sm font-semibold">
            Team settings
          </h2>
          <button
            type="button"
            class="grid size-7 place-items-center rounded text-lg leading-none text-gray-11 hover:bg-gray-4 hover:text-gray-12"
            onClick={() => dialog.close()}
            aria-label="Close team settings"
          >
            <IconBiX class="size-4 shrink-0" />
          </button>
        </div>
        <div class="p-4">
          <CreateTeamForm api={props.api} onCreated={props.onTeamCreated} />
          <div class="mt-3 space-y-1.5">
            <For each={props.members}>
              {(member) => (
                <div class="flex items-center gap-1.5">
                  <span class="min-w-0 flex-1 truncate font-mono text-[10px]">{member.userId}</span>
                  <Show
                    when={canManage() && member.role !== "owner"}
                    fallback={<span class="text-[10px] text-gray-11">{member.role}</span>}
                  >
                    <select
                      class="rounded border border-gray-6 bg-gray-1 px-1 py-0.5 text-[10px]"
                      value={member.role}
                      onChange={(event) =>
                        void setTeamMember(
                          member.userId,
                          event.currentTarget.value as "admin" | "member",
                        )
                      }
                    >
                      <option value="member">member</option>
                      <Show when={props.team?.role === "owner"}>
                        <option value="admin">admin</option>
                      </Show>
                    </select>
                    <button
                      type="button"
                      class="px-1 text-gray-11 hover:text-red-400"
                      onClick={() => void removeTeamMember(member.userId)}
                      aria-label={`Remove ${member.userId}`}
                    >
                      <IconBiX class="size-3.5 shrink-0" />
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <Show when={canManage()}>
            <AddTeamMemberForm onAdd={setTeamMember} />
          </Show>
        </div>
      </dialog>
    </>
  );
};
