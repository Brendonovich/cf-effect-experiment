import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Effect } from "effect";
import { createMemo } from "solid-js";

import { createEditorController, type EditorControllerOptions } from "./createEditorController";
import { Editor } from "./Editor";

function StoryEditor(props: Pick<EditorControllerOptions, "connection">) {
  const controller = createMemo(() =>
    createEditorController({
      connection: props.connection,
      workspaceId: "storybook",
      userId: "storybook-user",
      settingsDescriptors: [],
    }),
  );
  return <Editor controller={controller()} />;
}

const meta = {
  title: "Editor/Application",
  component: StoryEditor,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StoryEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connecting: Story = {
  args: { connection: Effect.never },
};

export const ConnectionFailed: Story = {
  args: { connection: Effect.fail(new Error("Unable to connect to the editor")) },
};
