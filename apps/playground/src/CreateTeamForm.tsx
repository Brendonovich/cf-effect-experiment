import { action, createSignal, type Component } from "solid-js";

import type { TeamsApiClient } from "./api";

import { runApi } from "./api";

interface CreateTeamDialogProps {
  readonly api: TeamsApiClient;
  readonly onCreated: (teamId: string) => void;
  readonly dialogRef: (dialog: HTMLDialogElement) => void;
}

export const CreateTeamDialog: Component<CreateTeamDialogProps> = (props) => {
  const [name, setName] = createSignal("");
  let dialog!: HTMLDialogElement;

  const createTeam = action(async function* (event: SubmitEvent) {
    event.preventDefault();
    const teamName = name().trim();
    if (teamName.length === 0) return;
    const body = await runApi(props.api.create({ payload: { name: teamName } }));
    yield;
    if (body === undefined) return;
    setName("");
    dialog.close();
    props.onCreated(body.team.id);
  });

  return (
    <dialog
      ref={(element) => {
        dialog = element;
        props.dialogRef(element);
      }}
      aria-labelledby="create-team-title"
      class="m-auto w-[min(30rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-gray-6 bg-gray-2 p-0 text-sm text-gray-12 shadow-2xl backdrop:bg-black/75"
      onClick={(event) => {
        if (event.target === dialog) dialog.close();
      }}
    >
      <div class="flex items-start justify-between border-b border-gray-5 px-5 py-5 sm:px-6">
        <div>
          <h2 id="create-team-title" class="text-base font-semibold tracking-tight">
            Create a new team
          </h2>
          <p class="mt-1 text-xs leading-5 text-gray-10">
            A shared workspace for projects and collaborators.
          </p>
        </div>
        <button
          type="button"
          class="grid size-8 shrink-0 place-items-center rounded-md text-gray-10 transition hover:bg-gray-4 hover:text-gray-12"
          onClick={() => dialog.close()}
          aria-label="Close create team dialog"
        >
          <IconBiX class="size-4 shrink-0" />
        </button>
      </div>
      <form class="p-5 sm:p-6" onSubmit={createTeam}>
        <label for="new-team-name" class="mb-2 block text-xs font-medium text-gray-11">
          Team name
        </label>
        <input
          id="new-team-name"
          class="focus-ring w-full rounded-md border border-gray-6 bg-gray-1 px-3 py-2.5 text-sm text-gray-12 placeholder:text-gray-9 focus:border-gray-8"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          placeholder="Acme studio"
          autofocus
        />
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md px-3.5 py-2 text-xs font-medium text-gray-11 transition hover:bg-gray-4 hover:text-gray-12"
            onClick={() => dialog.close()}
          >
            Cancel
          </button>
          <button class="rounded-md bg-gray-12 px-4 py-2 text-xs font-semibold text-gray-1 transition hover:bg-gray-11">
            Create team
          </button>
        </div>
      </form>
    </dialog>
  );
};
