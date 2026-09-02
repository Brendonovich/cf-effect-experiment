import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { DataType } from "@macrograph/plugin/DataType";
import { createSignal } from "solid-js";

import { DataTypePicker } from "./DataTypePicker";

const personId = DataType.DefinitionId.make("person");
const resultId = DataType.DefinitionId.make("result");
const definitions: DataType.Definitions = {
  person: { _tag: "Struct", id: personId, name: "Person", fields: [] },
  result: { _tag: "Enum", id: resultId, name: "Result", variants: [] },
};

const meta: Meta<typeof DataTypePicker> = {
  title: "Editor/Controls/DataTypePicker",
  component: DataTypePicker,
  args: {
    value: DataType.Option(DataType.List(DataType.Custom(personId))),
    definitions,
    label: "Field type",
    onChange: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ width: "min(100%, 680px)", "min-height": "320px" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DataTypePicker>;

export const Interactive: Story = {
  render: (args) => {
    const [value, setValue] = createSignal(args.value);
    return <DataTypePicker {...args} value={value()} onChange={setValue} />;
  },
};
