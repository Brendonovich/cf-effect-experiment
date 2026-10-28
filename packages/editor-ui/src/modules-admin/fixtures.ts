import { type ModuleAdminRpc, ModuleCatalog, ModuleId } from "@macrograph/module";

const official = (publisher: string, name: string) =>
  ModuleId.make({ namespace: ModuleId.OfficialNamespace, publisher, name });

export const fixtureIds = {
  twitch: official("macrograph", "twitch"),
  obs: official("macrograph", "obs"),
  kofi: official("macrograph", "kofi"),
  discord: official("acme", "discord"),
  lights: ModuleId.make({ namespace: "modules.example.com", publisher: "lumen", name: "lights" }),
  overlay: ModuleId.make({ namespace: ModuleId.LocalNamespace, publisher: "me", name: "overlay" }),
  linked: ModuleId.make({
    namespace: ModuleId.OfficialNamespace,
    publisher: "me",
    name: "chatbot",
  }),
};

const copy = (
  source: ModuleCatalog.SourceKind,
  version: string,
  path: string,
  compatible = true,
): ModuleAdminRpc.ModuleCopy => ({ source, version, api: compatible ? 1 : 2, compatible, path });

export const fixtureModules: ReadonlyArray<ModuleAdminRpc.ModuleDetails> = [
  {
    entry: {
      id: fixtureIds.twitch,
      version: "1.4.0",
      displayName: "Twitch",
      description: "Chat, follows, subscriptions and channel point redemptions.",
      source: "shipped",
      status: "loaded",
      flags: ModuleCatalog.noFlags,
      trust: { registry: ModuleId.OfficialNamespace, installed: "trusted", current: "trusted" },
    },
    enabled: true,
    copies: [copy("shipped", "1.4.0", "dist/modules/macrograph.app/macrograph/twitch/1.4.0")],
  },
  {
    entry: {
      id: fixtureIds.obs,
      version: "2.0.1",
      displayName: "OBS Studio",
      source: "shipped",
      status: "disabled",
      flags: ModuleCatalog.noFlags,
      trust: { registry: ModuleId.OfficialNamespace, installed: "trusted" },
    },
    enabled: false,
    copies: [copy("shipped", "2.0.1", "dist/modules/macrograph.app/macrograph/obs/2.0.1")],
  },
  {
    entry: {
      id: fixtureIds.discord,
      version: "0.3.0",
      displayName: "Discord",
      description: "Send messages and react to events from a Discord bot.",
      source: "installed",
      status: "loaded",
      flags: { ...ModuleCatalog.noFlags, updateAvailable: true },
      trust: { registry: ModuleId.OfficialNamespace, installed: "untrusted", current: "untrusted" },
    },
    enabled: true,
    copies: [copy("installed", "0.3.0", "installed/macrograph.app/acme/discord/0.3.0")],
  },
  {
    entry: {
      id: fixtureIds.overlay,
      version: "0.1.0",
      displayName: "Stream overlay",
      source: "local",
      status: "loaded",
      flags: { ...ModuleCatalog.noFlags, stale: true },
    },
    enabled: true,
    path: "/srv/macrograph/modules/local/me/overlay",
    copies: [copy("local", "0.1.0", "local/me/overlay")],
  },
];

export const fixtureFlaggedModules: ReadonlyArray<ModuleAdminRpc.ModuleDetails> = [
  ...fixtureModules,
  {
    entry: {
      id: fixtureIds.lights,
      version: "1.2.0",
      displayName: "Smart lights",
      source: "installed",
      status: "loaded",
      flags: { ...ModuleCatalog.noFlags, revoked: true },
      trust: {
        registry: "modules.example.com",
        installed: "trusted",
        current: "untrusted",
        reason: "This release sends your access tokens to a third-party server.",
      },
    },
    enabled: true,
    copies: [copy("installed", "1.2.0", "installed/modules.example.com/lumen/lights/1.2.0")],
  },
  {
    entry: {
      id: fixtureIds.kofi,
      version: "1.0.0",
      displayName: "Ko-fi",
      source: "shipped",
      status: "loaded",
      flags: { ...ModuleCatalog.noFlags, incompatibleInstalled: true },
      trust: { registry: ModuleId.OfficialNamespace, installed: "trusted", current: "trusted" },
    },
    enabled: true,
    copies: [
      copy("shipped", "1.0.0", "dist/modules/macrograph.app/macrograph/kofi/1.0.0"),
      copy("installed", "2.0.0", "installed/macrograph.app/macrograph/kofi/2.0.0", false),
    ],
  },
  {
    entry: {
      id: fixtureIds.linked,
      version: "0.0.1",
      displayName: "Chat bot (dev)",
      source: "linked",
      status: "failed",
      flags: ModuleCatalog.noFlags,
      error:
        "Module evaluation failed: ReferenceError: chatClient is not defined\n    at server.cjs:14:3",
    },
    enabled: true,
    path: "/home/me/code/chatbot/dist",
    copies: [copy("linked", "0.0.1", "/home/me/code/chatbot/dist")],
  },
];

export const fixtureRegistries: ReadonlyArray<ModuleAdminRpc.Registry> = [
  {
    namespace: ModuleId.OfficialNamespace,
    url: "https://registry.macrograph.app",
    displayName: "MacroGraph",
    official: true,
    trusted: true,
    keys: ["MCowBQYDK2VwAyEA"],
  },
  {
    namespace: "modules.example.com",
    url: "https://modules.example.com",
    displayName: "Example community registry",
    official: false,
    trusted: false,
    keys: ["MCowBQYDK2VwAyEB"],
  },
];

const release = (
  version: string,
  overrides: Partial<ModuleAdminRpc.RegistryRelease> = {},
): ModuleAdminRpc.RegistryRelease => ({
  version,
  api: 1,
  compatible: true,
  publishedAt: "2026-09-14T10:00:00.000Z",
  trust: "trusted",
  status: "active",
  requires: [],
  node: [],
  native: [],
  ...overrides,
});

export const fixturePackages: ReadonlyArray<ModuleAdminRpc.RegistryPackage> = [
  {
    id: fixtureIds.discord,
    displayName: "Discord",
    description: "Send messages and react to events from a Discord bot.",
    releases: [
      release("0.4.0", {
        trust: "untrusted",
        requires: ["http-client", "socket", "credentials"],
        node: ["net", "tls"],
      }),
      release("0.3.0", { trust: "untrusted", requires: ["credentials"], node: ["net"] }),
    ],
  },
  {
    id: official("macrograph", "spotify"),
    displayName: "Spotify",
    description: "Control playback and react to track changes.",
    releases: [
      release("1.1.0", { requires: ["credentials"] }),
      release("1.0.0", { status: "yanked", reason: "Broke token refresh." }),
      release("2.0.0-beta.1", { api: 2, compatible: false }),
    ],
  },
  {
    id: fixtureIds.lights,
    displayName: "Smart lights",
    description: "Hue and LIFX lights.",
    releases: [
      release("1.2.0", {
        trust: "untrusted",
        status: "revoked",
        reason: "This release sends your access tokens to a third-party server.",
      }),
      release("1.1.0", { trust: "untrusted", node: ["dgram"] }),
    ],
  },
  {
    id: ModuleId.make({ namespace: "modules.example.com", publisher: "lumen", name: "timer" }),
    displayName: "Countdown timer",
    releases: [release("0.2.0", { trust: "untrusted", native: ["chime"] })],
  },
];
