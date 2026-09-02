import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { createSignal, For } from "solid-js";

import {
  constants,
  graph,
  noop,
  obsPackage,
  packages,
  resourceValues,
  secondaryGraph,
  twitchPackage,
  utilityPackage,
} from "../storybook-fixtures";
import { NavigationSidebar } from "./NavigationSidebar";

const meta: Meta<typeof NavigationSidebar> = {
  title: "Editor/Navigation/NavigationSidebar",
  component: NavigationSidebar,
  args: {
    section: "graphs",
    search: "",
    selectedPaneId: `graph:${graph.id}`,
    graphs: [
      [graph.id, graph],
      [secondaryGraph.id, secondaryGraph],
    ],
    packagesWithSettings: [twitchPackage, obsPackage],
    packagesWithoutSettings: [utilityPackage],
    allPackages: packages,
    constants,
    onSectionChange: noop,
    onSearchChange: noop,
    onClose: noop,
    onCreateGraph: noop,
    onSelectGraph: noop,
    canEditGraphs: true,
    onRenameGraph: noop,
    onDeleteGraph: noop,
    onOpenPackage: noop,
    onCreateConstant: noop,
    onRenameConstant: noop,
    onSelectConstant: noop,
    onSetDefaultConstant: noop,
    canEditConstants: true,
    onDeleteConstant: noop,
    resourceDefinition: (resource) => {
      const pkg = packages.find((candidate) => candidate.id === resource.package);
      const definition = pkg?.resources.find((candidate) => candidate.id === resource.resource);
      return pkg && definition ? { pkg, definition } : undefined;
    },
    valuesFor: resourceValues,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ padding: "24px" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NavigationSidebar>;

export const Sections: Story = {
  render: (args) => (
    <div class="storybook-showcase storybook-showcase--sidebars">
      <For
        each={
          [
            { label: "Graphs", section: "graphs", selectedPaneId: `graph:${graph.id}` },
            { label: "Packages", section: "packages", selectedPaneId: "package:twitch" },
            { label: "Constants", section: "constants", selectedPaneId: undefined },
          ] as const
        }
      >
        {(variant) => (
          <section class="storybook-showcase__item">
            <h2 class="storybook-showcase__label">{variant.label}</h2>
            <div class="storybook-showcase__frame">
              <NavigationSidebar
                {...args}
                section={variant.section}
                selectedPaneId={variant.selectedPaneId}
              />
            </div>
          </section>
        )}
      </For>
    </div>
  ),
};

export const DefaultConstants: Story = {
  args: { section: "constants" },
  render: (args) => {
    const [items, setItems] = createSignal(() => args.constants);
    return (
      <NavigationSidebar
        {...args}
        constants={items()}
        onRenameConstant={async (id, name) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          setItems((current) => {
            const constant = current[id];
            return constant ? { ...current, [id]: { ...constant, name } } : current;
          });
        }}
        onDeleteConstant={(id) => {
          setItems((current) => {
            const { [id]: removed, ...remaining } = current;
            return remaining;
          });
        }}
        onSetDefaultConstant={(id) => {
          const selected = items()[id];
          if (!selected) return;
          setItems((current) =>
            Object.fromEntries(
              Object.entries(current).map(([key, constant]) => [
                key,
                constant.resource.package === selected.resource.package &&
                constant.resource.resource === selected.resource.resource
                  ? { ...constant, isDefault: key === id }
                  : constant,
              ]),
            ),
          );
        }}
      />
    );
  },
};
