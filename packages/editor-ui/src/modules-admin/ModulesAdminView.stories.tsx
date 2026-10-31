import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { ModuleAdminRpc, ModuleCatalog, ModuleId } from "@macrograph/module";
import { Effect } from "effect";
import { onCleanup, untrack } from "solid-js";

import {
  fixtureFlaggedModules,
  fixtureIds,
  fixtureModules,
  fixturePackages,
  fixtureRegistries,
} from "./fixtures.ts";
import { createMockModuleAdmin, type MockModuleAdminOptions } from "./mockModuleAdmin.ts";
import { type ModulesAdminTab, ModulesAdminView } from "./ModulesAdminView.tsx";
import { UntrustedInstallDialog } from "./UntrustedInstallDialog.tsx";

function MockedModulesAdmin(props: {
  readonly options: MockModuleAdminOptions;
  readonly initialTab?: ModulesAdminTab;
  readonly initialSearch?: string;
}) {
  const mock = untrack(() =>
    createMockModuleAdmin({
      registries: fixtureRegistries,
      packages: fixturePackages,
      latency: 400,
      ...props.options,
    }),
  );
  onCleanup(mock.dispose);
  return (
    <ModulesAdminView
      client={mock.client}
      subscribeModulesChanged={mock.subscribeModulesChanged}
      initialTab={props.initialTab}
      initialSearch={props.initialSearch}
    />
  );
}

const meta = {
  title: "Modules Admin/Modules Admin View",
  component: MockedModulesAdmin,
  parameters: { layout: "padded" },
} satisfies Meta<typeof MockedModulesAdmin>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Modules: Story = {
  args: { options: { modules: fixtureModules } },
};

export const FlaggedModules: Story = {
  name: "Stale, revoked, update and incompatible",
  args: { options: { modules: fixtureFlaggedModules } },
};

export const FailedModule: Story = {
  args: {
    options: {
      modules: [
        {
          entry: {
            id: ModuleId.make({ namespace: "local", publisher: "me", name: "broken" }),
            version: "0.0.1",
            displayName: "Broken module",
            source: "local",
            status: "failed",
            flags: ModuleCatalog.noFlags,
            error:
              'Module requires host services this server does not offer: "socket"\nSet "requires" in macrograph.json to the services the module uses.',
          },
          enabled: true,
          path: "/srv/macrograph/modules/local/me/broken",
          copies: [],
        },
      ],
      overrides: {
        // Reloading leaves the module failed with a new error.
        ReloadModule: ({ id }) =>
          Effect.succeed({
            id,
            version: "0.0.1",
            displayName: "Broken module",
            source: "local" as const,
            status: "failed" as const,
            flags: ModuleCatalog.noFlags,
            error: "Module still requires the socket host service",
          }),
      },
    },
  },
};

export const RegistrySearch: Story = {
  args: {
    options: { modules: fixtureModules },
    initialTab: "browse",
    initialSearch: "",
  },
};

export const RegistrySearchError: Story = {
  args: {
    options: {
      modules: fixtureModules,
      overrides: {
        SearchRegistry: () =>
          Effect.fail(
            new ModuleAdminRpc.RegistryError({
              namespace: "modules.example.com",
              message: "The registry answered with HTTP 503",
            }),
          ),
      },
    },
    initialTab: "browse",
    initialSearch: "lights",
  },
};

export const Registries: Story = {
  args: { options: { modules: fixtureModules }, initialTab: "registries" },
};

export const DevLinks: Story = {
  args: { options: { modules: fixtureFlaggedModules }, initialTab: "links" },
};

export const UntrustedInstall: StoryObj<typeof UntrustedInstallDialog> = {
  render: (args) => <UntrustedInstallDialog {...args} />,
  args: {
    confirmation: {
      kind: "install",
      id: fixtureIds.discord,
      version: "0.4.0",
      registry: ModuleId.OfficialNamespace,
      requires: ["http-client", "socket", "credentials"],
      node: ["net", "tls"],
      native: [],
    },
    registryName: "MacroGraph",
    pending: false,
    error: null,
    onConfirm: () => {},
    onCancel: () => {},
  },
};

export const UntrustedInstallFailed: StoryObj<typeof UntrustedInstallDialog> = {
  ...UntrustedInstall,
  args: {
    ...UntrustedInstall.args,
    error: "Installing acme/discord failed: the integrity hash didn't match the download.",
  },
};
