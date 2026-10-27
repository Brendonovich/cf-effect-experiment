import { ModuleAdminRpc, ModuleCatalog, ModuleId } from "@macrograph/module";
import { render } from "@solidjs/web";
import { Effect } from "effect";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

import {
  fixtureFlaggedModules,
  fixtureIds,
  fixturePackages,
  fixtureRegistries,
} from "../../src/modules-admin/fixtures";
import {
  createMockModuleAdmin,
  type MockModuleAdmin,
  type MockModuleAdminOptions,
} from "../../src/modules-admin/mockModuleAdmin";
import { type ModulesAdminTab, ModulesAdminView } from "../../src/modules-admin/ModulesAdminView";

let dispose = () => {};
let admin: MockModuleAdmin | undefined;
afterEach(() => {
  dispose();
  admin?.dispose();
  admin = undefined;
  document.body.replaceChildren();
});

const mount = (options: MockModuleAdminOptions = {}, initialTab?: ModulesAdminTab) => {
  const mock = createMockModuleAdmin({
    modules: fixtureFlaggedModules,
    registries: fixtureRegistries,
    packages: fixturePackages,
    ...options,
  });
  admin = mock;
  dispose = render(
    () => (
      <ModulesAdminView
        client={mock.client}
        subscribeModulesChanged={mock.subscribeModulesChanged}
        initialTab={initialTab}
      />
    ),
    document.body,
  );
  flush();
  return mock;
};

const settle = (assertion: () => void) =>
  vi.waitFor(() => {
    flush();
    assertion();
  });

const row = (id: string) => document.querySelector<HTMLElement>(`[data-module-row="${id}"]`);
const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.textContent === label || candidate.getAttribute("aria-label") === label,
  );
const openPackage = async (name: string) => {
  await settle(() => expect(button(document, "Search")).toBeDefined());
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search modules"]')!;
  search.value = name;
  search.dispatchEvent(new InputEvent("input", { bubbles: true }));
  flush();
  document.querySelector<HTMLFormElement>('form[role="search"]')!.requestSubmit();
  const result = `[data-search-result$="/${name}"] button`;
  await settle(() => expect(document.querySelector(result)).not.toBeNull());
  document.querySelector<HTMLButtonElement>(result)!.click();
  await settle(() =>
    expect(document.querySelector("[data-registry-package] table")).not.toBeNull(),
  );
};
const dialog = () => document.querySelector<HTMLDialogElement>("[data-untrusted-install-dialog]");

it("lists modules with their source, trust, flags and errors", async () => {
  mount();
  await settle(() => expect(row(fixtureIds.twitch)).not.toBeNull());

  const twitch = row(fixtureIds.twitch)!;
  expect(twitch.textContent).toContain("macrograph/twitch");
  expect(twitch.textContent).toContain("Built-in");
  expect(twitch.textContent).toContain("Trusted");
  expect(button(twitch, "Uninstall Twitch")).toBeUndefined();

  const lights = row(fixtureIds.lights)!;
  expect(lights.textContent).toContain("modules.example.com/lumen/lights");
  expect(lights.querySelector('[role="alert"]')?.textContent).toContain(
    "This release sends your access tokens to a third-party server.",
  );
  expect(button(lights, "Uninstall Smart lights")).toBeDefined();

  expect(row(fixtureIds.overlay)!.textContent).toContain("Changed on disk");
  expect(row(fixtureIds.overlay)!.textContent).toContain("Local");
  expect(row(fixtureIds.discord)!.textContent).toContain("Update available");
  expect(row(fixtureIds.kofi)!.textContent).toContain("2.0.0 (module API 2) isn't compatible");
  expect(row(fixtureIds.linked)!.textContent).toContain("chatClient is not defined");
  expect(row(fixtureIds.linked)!.textContent).toContain("Failed");
});

it("refetches the modules when ModulesChanged fires", async () => {
  const mock = mount();
  await settle(() => expect(row(fixtureIds.twitch)).not.toBeNull());
  const listCalls = () => mock.calls.filter((call) => call.tag === "ListModules").length;
  const before = listCalls();

  const newcomer = ModuleAdminRpc.ModuleDetails.make({
    entry: {
      id: ModuleId.make({ namespace: "local", publisher: "me", name: "clock" }),
      version: "0.1.0",
      displayName: "Clock",
      source: "local",
      status: "loaded",
      flags: ModuleCatalog.noFlags,
    },
    enabled: true,
    copies: [],
  });
  mock.state.modules.push(newcomer);
  flush();
  expect(row(newcomer.entry.id)).toBeNull();

  mock.emitModulesChanged();
  await settle(() => expect(row(newcomer.entry.id)?.textContent).toContain("Clock"));
  expect(listCalls()).toBeGreaterThan(before);
});

it("asks for confirmation when the server requires it and sends the acknowledgement", async () => {
  const mock = mount();
  await settle(() => expect(row(fixtureIds.discord)).not.toBeNull());

  button(row(fixtureIds.discord)!, "Update")!.click();
  await settle(() => expect(dialog()).not.toBeNull());
  expect(mock.calls.filter((call) => call.tag === "UpdateModule")).toEqual([
    { tag: "UpdateModule", payload: { id: fixtureIds.discord, acknowledgeUntrusted: false } },
  ]);
  // The server's refusal is what opened the dialog, so it isn't shown as an error.
  expect(document.querySelector('[data-modules-admin] > [role="alert"]')).toBeNull();

  expect(dialog()!.open).toBe(true);
  const text = dialog()!.textContent!;
  expect(text).toContain("Update an untrusted module?");
  expect(text).toContain("acme");
  expect(text).toContain("MacroGraph");
  expect(text).toContain("http-client");
  expect(text).toContain("credentials");
  expect(text).toContain("tls");
  expect(text).toContain("isn't verified");
  expect(text).toContain("not a sandbox");

  const confirm = dialog()!.querySelector<HTMLButtonElement>("[data-untrusted-confirm]")!;
  expect(confirm.disabled).toBe(true);
  const checkbox = dialog()!.querySelector<HTMLInputElement>("[data-untrusted-acknowledge]")!;
  checkbox.click();
  flush();
  expect(confirm.disabled).toBe(false);

  confirm.click();
  await settle(() => expect(dialog()).toBeNull());
  expect(mock.calls.filter((call) => call.tag === "UpdateModule").at(-1)).toEqual({
    tag: "UpdateModule",
    payload: { id: fixtureIds.discord, version: "0.4.0", acknowledgeUntrusted: true },
  });
  await settle(() => expect(row(fixtureIds.discord)!.textContent).toContain("0.4.0"));
});

it("opens the confirmation before installing a release known to be untrusted", async () => {
  const mock = mount({ modules: [] }, "browse");
  await openPackage("timer");
  expect(mock.calls.find((call) => call.tag === "SearchRegistry")?.payload).toEqual({
    query: "timer",
  });
  button(document.querySelector('[data-release="0.2.0"]')!, "Install 0.2.0")!.click();
  await settle(() => expect(dialog()).not.toBeNull());
  expect(mock.calls.some((call) => call.tag === "InstallModule")).toBe(false);
  expect(dialog()!.textContent).toContain("Example community registry");

  // Cancelling sends nothing.
  button(dialog()!, "Cancel")!.click();
  await settle(() => expect(dialog()).toBeNull());
  expect(mock.calls.some((call) => call.tag === "InstallModule")).toBe(false);

  button(document.querySelector('[data-release="0.2.0"]')!, "Install 0.2.0")!.click();
  await settle(() => expect(dialog()).not.toBeNull());
  dialog()!.querySelector<HTMLInputElement>("[data-untrusted-acknowledge]")!.click();
  flush();
  dialog()!.querySelector<HTMLButtonElement>("[data-untrusted-confirm]")!.click();
  await settle(() => expect(dialog()).toBeNull());
  expect(mock.calls.filter((call) => call.tag === "InstallModule")).toEqual([
    {
      tag: "InstallModule",
      payload: {
        id: "modules.example.com/lumen/timer",
        version: "0.2.0",
        acknowledgeUntrusted: true,
      },
    },
  ]);
  await settle(() =>
    expect(document.querySelector('[data-release="0.2.0"]')!.textContent).toContain("Installed"),
  );
});

it("keeps the dialog open and shows the error when a confirmed install fails", async () => {
  mount(
    {
      modules: [],
      overrides: {
        InstallModule: ({ id, acknowledgeUntrusted }) =>
          acknowledgeUntrusted
            ? Effect.fail(new ModuleAdminRpc.InstallFailed({ id, message: "Disk full" }))
            : Effect.fail(
                new ModuleAdminRpc.UntrustedConfirmationRequired({
                  id,
                  version: "0.2.0",
                  registry: "modules.example.com",
                  requires: [],
                  node: [],
                }),
              ),
      },
    },
    "browse",
  );
  await openPackage("spotify");
  button(document.querySelector('[data-release="1.1.0"]')!, "Install 1.1.0")!.click();
  // The release looked trusted, so only the server's answer opens the dialog.
  await settle(() => expect(dialog()).not.toBeNull());
  dialog()!.querySelector<HTMLInputElement>("[data-untrusted-acknowledge]")!.click();
  flush();
  dialog()!.querySelector<HTMLButtonElement>("[data-untrusted-confirm]")!.click();
  await settle(() =>
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(
      "Installing macrograph/spotify failed: Disk full",
    ),
  );
  expect(dialog()!.querySelector<HTMLButtonElement>("[data-untrusted-confirm]")!.disabled).toBe(
    false,
  );
});

it("shows pending and error state for lifecycle actions", async () => {
  const mock = mount({
    latency: 30,
    overrides: {
      ReloadModule: ({ id }) => Effect.fail(new ModuleAdminRpc.ModuleNotFound({ id })),
    },
  });
  await settle(() => expect(row(fixtureIds.twitch)).not.toBeNull());

  const reload = button(row(fixtureIds.twitch)!, "Reload Twitch")!;
  reload.click();
  flush();
  expect(reload.textContent).toBe("Reloading...");
  expect(reload.disabled).toBe(true);
  expect(button(row(fixtureIds.twitch)!, "Disable")!.disabled).toBe(true);

  await settle(() =>
    expect(row(fixtureIds.twitch)!.querySelector('[role="alert"]')?.textContent).toBe(
      "Module macrograph/twitch was not found.",
    ),
  );
  expect(reload.textContent).toBe("Reload");
  expect(reload.disabled).toBe(false);
  expect(mock.calls.filter((call) => call.tag === "ReloadModule")).toHaveLength(1);
});
