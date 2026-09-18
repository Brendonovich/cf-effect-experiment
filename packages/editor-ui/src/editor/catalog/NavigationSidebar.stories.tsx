import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Graph } from "@macrograph/core";
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
import { NavigationSidebar, type NavigationSection } from "./NavigationSidebar";

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
            { label: "Modules", section: "packages", selectedPaneId: "package:twitch" },
            { label: "Functions", section: "functions", selectedPaneId: undefined },
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

export const Interactive: Story = {
  render: (args) => {
    const functionGraph: Graph.Model = {
      ...secondaryGraph,
      name: "Format Alert",
      kind: "function",
      signature: {
        inputs: [{ id: "message", name: "Message", type: { _tag: "String" } }],
        outputs: [{ id: "result", name: "Result", type: { _tag: "String" } }],
      },
    };
    const [section, setSection] = createSignal<NavigationSection>("graphs");
    const [search, setSearch] = createSignal("");
    const [selectedPaneId, setSelectedPaneId] = createSignal<string>();
    const [graphs, setGraphs] = createSignal<ReadonlyArray<readonly [string, Graph.Model]>>([
      [graph.id, graph],
      [functionGraph.id, functionGraph],
    ]);
    const filteredGraphs = () => {
      const query = search().trim().toLowerCase();
      return query === ""
        ? graphs()
        : graphs().filter(([id, item]) =>
            [id, item.name].some((value) => value.toLowerCase().includes(query)),
          );
    };
    const filteredPackages = (items: typeof packages) => {
      const query = search().trim().toLowerCase();
      return query === ""
        ? items
        : items.filter((item) =>
            [item.id, item.name].some((value) => value.toLowerCase().includes(query)),
          );
    };
    const createGraph = (kind: "ordinary" | "function") => {
      const id = crypto.randomUUID();
      const created: Graph.Model = {
        ...Graph.empty(id),
        name: kind === "function" ? "New Function" : "New Graph",
        kind,
        ...(kind === "function" ? { signature: { inputs: [], outputs: [] } } : {}),
      };
      setGraphs((items) => [...items, [id, created]]);
      setSelectedPaneId(`graph:${id}`);
    };
    return (
      <div style={{ display: "flex", height: "640px", width: "224px" }}>
        <NavigationSidebar
          {...args}
          section={section()}
          search={search()}
          selectedPaneId={selectedPaneId()}
          graphs={filteredGraphs()}
          packagesWithSettings={filteredPackages([twitchPackage, obsPackage])}
          packagesWithoutSettings={filteredPackages([utilityPackage])}
          onSectionChange={(next) => {
            setSection(next);
            setSearch("");
          }}
          onSearchChange={setSearch}
          onCreateGraph={() => createGraph("ordinary")}
          onCreateFunction={() => createGraph("function")}
          onSelectGraph={(id) => setSelectedPaneId(`graph:${id}`)}
          onRenameGraph={(id, name) =>
            setGraphs((items) =>
              items.map(([itemId, item]) => [itemId, itemId === id ? { ...item, name } : item]),
            )
          }
          onDeleteGraph={(id) => setGraphs((items) => items.filter(([itemId]) => itemId !== id))}
          onOpenPackage={(id) => setSelectedPaneId(`package:${id}`)}
        />
      </div>
    );
  },
};
