import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { DataType } from "@macrograph/plugin/DataType";
import { createSignal } from "solid-js";

import { DataTypePicker } from "./DataTypePicker";

const meta: Meta<typeof DataTypePicker> = {
  title: "Editor/Controls/DataTypePicker",
  component: DataTypePicker,
};
export default meta;
export const Nested: StoryObj<typeof DataTypePicker> = {
  render: () => {
    const [value, setValue] = createSignal<DataType.Any>(
      DataType.List(DataType.Option(DataType.List(DataType.Int))),
    );
    return (
      <div style={{ width: "220px", "min-height": "400px" }}>
        <DataTypePicker value={value()} onChange={setValue} />
        <pre>{JSON.stringify(value(), null, 2)}</pre>
      </div>
    );
  },
};
