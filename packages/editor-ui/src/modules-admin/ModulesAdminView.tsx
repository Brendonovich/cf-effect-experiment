import type { JSX } from "@solidjs/web";

import { ModuleId } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";
import {
  describeError,
  isUntrustedConfirmationRequired,
  type ModuleAdminClient,
  queryKeys,
  run,
  type SubscribeModulesChanged,
} from "./client.ts";
import { type InstallRequest, ModulesAdminContext } from "./context.ts";
import { DevLinksPanel } from "./DevLinksPanel.tsx";
import { ModulesList } from "./ModulesList.tsx";
import { Notice } from "./primitives.tsx";
import { RegistriesPanel } from "./RegistriesPanel.tsx";
import { RegistryBrowser } from "./RegistryBrowser.tsx";
import { type UntrustedConfirmation, UntrustedInstallDialog } from "./UntrustedInstallDialog.tsx";

export type ModulesAdminTab = "modules" | "browse" | "registries" | "links";

export interface ModulesAdminViewProps {
  readonly client: ModuleAdminClient;
  /** Subscribes to `ModulesChanged`; the view refetches whenever it fires. */
  readonly subscribeModulesChanged?: SubscribeModulesChanged | undefined;
  readonly initialTab?: ModulesAdminTab | undefined;
  /** Runs this registry search when the browse tab opens. */
  readonly initialSearch?: string | undefined;
  /** Supply a query client to share its cache; one is created otherwise. */
  readonly queryClient?: QueryClient;
}

const tabs: ReadonlyArray<{ readonly id: ModulesAdminTab; readonly label: string }> = [
  { id: "modules", label: "Modules" },
  { id: "browse", label: "Browse registries" },
  { id: "registries", label: "Registries" },
  { id: "links", label: "Dev links" },
];

interface InstallVariables {
  readonly kind: InstallRequest["kind"];
  readonly id: ModuleId.Id;
  readonly version?: string;
  readonly acknowledgeUntrusted: boolean;
}

/** Manage the server's modules: lifecycle, registries, installs and dev links. */
export function ModulesAdminView(props: ModulesAdminViewProps) {
  const fallbackClient = new QueryClient({
    defaultOptions: {
      queries: { networkMode: "always", retry: false },
      mutations: { networkMode: "always", retry: false },
    },
  });
  onCleanup(() => fallbackClient.clear());
  const queryClient = createMemo(() => props.queryClient ?? fallbackClient);

  return (
    <QueryClientProvider client={queryClient()}>
      <ModulesAdminContent
        client={props.client}
        subscribeModulesChanged={props.subscribeModulesChanged}
        initialTab={props.initialTab}
        initialSearch={props.initialSearch}
      />
    </QueryClientProvider>
  );
}

function ModulesAdminContent(props: Omit<ModulesAdminViewProps, "queryClient">) {
  const queryClient = useQueryClient();
  const [tab, setTab] = createSignal<ModulesAdminTab>(props.initialTab ?? "modules");
  const [confirmation, setConfirmation] = createSignal<UntrustedConfirmation | null>(null);

  createEffect(
    () => props.subscribeModulesChanged,
    (subscribe) =>
      subscribe?.(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.all });
      }),
  );

  const registries = useQuery(() => ({
    queryKey: queryKeys.registries,
    queryFn: () => run(props.client.ListRegistries({})),
  }));

  const install = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: (variables: InstallVariables) => {
      const payload = {
        id: variables.id,
        acknowledgeUntrusted: variables.acknowledgeUntrusted,
        ...(variables.version === undefined ? {} : { version: variables.version }),
      };
      return run(
        variables.kind === "install"
          ? props.client.InstallModule(payload)
          : props.client.UpdateModule(payload),
      );
    },
    onSuccess: () => {
      setConfirmation(null);
      return queryClient.invalidateQueries({ queryKey: queryKeys.all });
    },
    onError: (error: unknown, variables: InstallVariables) => {
      if (isUntrustedConfirmationRequired(error) && !variables.acknowledgeUntrusted)
        setConfirmation({
          kind: variables.kind,
          id: error.id,
          version: error.version,
          registry: error.registry,
          requires: error.requires,
          node: error.node,
        });
    },
  }));

  const requestInstall = (request: InstallRequest) => {
    if (install.isPending) return;
    install.reset();
    if (request.untrusted) {
      setConfirmation({
        kind: request.kind,
        id: request.id,
        version: request.untrusted.version,
        registry: ModuleId.namespace(request.id),
        requires: request.untrusted.requires,
        node: request.untrusted.node,
      });
      return;
    }
    install.mutate({
      kind: request.kind,
      id: request.id,
      ...(request.version === undefined ? {} : { version: request.version }),
      acknowledgeUntrusted: false,
    });
  };

  const confirm = () => {
    const current = confirmation();
    if (!current || install.isPending) return;
    install.mutate({
      kind: current.kind,
      id: current.id,
      version: current.version,
      acknowledgeUntrusted: true,
    });
  };

  const cancel = () => {
    setConfirmation(null);
    install.reset();
  };

  const confirmedError = createMemo(() =>
    install.isError && install.variables?.acknowledgeUntrusted
      ? describeError(install.error)
      : null,
  );
  const flowError = createMemo(() => {
    if (!install.isError || confirmation() !== null) return null;
    if (isUntrustedConfirmationRequired(install.error) && !install.variables?.acknowledgeUntrusted)
      return null;
    return describeError(install.error);
  });
  const registryName = createMemo(() => {
    const current = confirmation();
    if (!current) return undefined;
    return registries.data?.find((registry) => registry.namespace === current.registry)
      ?.displayName;
  });

  const installing = (id: ModuleId.Id) =>
    install.isPending && install.variables?.id === id ? install.variables.kind : null;

  const panels: Record<ModulesAdminTab, () => JSX.Element> = {
    modules: () => <ModulesList />,
    browse: () => <RegistryBrowser initialSearch={props.initialSearch} />,
    registries: () => <RegistriesPanel />,
    links: () => <DevLinksPanel />,
  };

  return (
    <ModulesAdminContext value={{ client: () => props.client, requestInstall, installing }}>
      <section sx={styles.root} aria-labelledby="modules-admin-heading" data-modules-admin>
        <header sx={styles.header}>
          <h3 id="modules-admin-heading" sx={styles.heading}>
            Modules
          </h3>
          <p sx={styles.description}>
            Modules are trusted code that runs inside this server and in the editor. Trust badges
            and signatures say who vouches for a release; they don't isolate it.
          </p>
        </header>

        <div sx={styles.tabs} role="tablist" aria-label="Module management">
          <For each={tabs}>
            {(item) => (
              <button
                type="button"
                role="tab"
                sx={[styles.tab, tab() === item.id && styles.tabActive]}
                aria-selected={tab() === item.id ? "true" : "false"}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>

        <Show when={flowError()}>
          {(error) => (
            <Notice
              tone="danger"
              role="alert"
              action={
                <Button type="button" size="sm" variant="text" onClick={() => install.reset()}>
                  Dismiss
                </Button>
              }
            >
              {error()}
            </Notice>
          )}
        </Show>

        <div sx={styles.panel} role="tabpanel">
          {panels[tab()]()}
        </div>

        <Show when={confirmation()} keyed>
          {(current) => (
            <UntrustedInstallDialog
              confirmation={current}
              registryName={registryName()}
              pending={install.isPending}
              error={confirmedError()}
              onConfirm={confirm}
              onCancel={cancel}
            />
          )}
        </Show>
      </section>
    </ModulesAdminContext>
  );
}

const styles = stylex.create({
  root: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: "100%",
    maxWidth: 880,
    padding: 12,
    fontSize: 12,
    color: colors.gray12,
  },
  header: { display: "flex", flexDirection: "column", gap: 4 },
  heading: { margin: 0, fontSize: 14, fontWeight: 500 },
  description: { margin: 0, lineHeight: "20px", color: colors.gray11 },
  tabs: {
    display: "flex",
    gap: 2,
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  tab: {
    borderWidth: 0,
    borderBottomColor: "transparent",
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    backgroundColor: "transparent",
    color: { default: colors.gray11, ":hover": colors.gray12 },
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    paddingBlock: 6,
    paddingInline: 10,
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  tabActive: { borderBottomColor: colors.gray12, color: colors.gray12 },
  panel: { display: "flex", flexDirection: "column", gap: 12 },
});
