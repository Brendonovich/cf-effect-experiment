import type { JSX } from "@solidjs/web";

import { randomUUID } from "@macrograph/editor";
import {
  Button,
  CredentialSettings,
  createEditorController,
  RealtimeWorkspace,
  macrographLogo,
} from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { createSignal, For, onSettled, Show } from "solid-js";
import discoveredModuleSettings from "virtual:macrograph-module-settings";

import { makeBrowserCredentialProvider } from "./local/BrowserCredentials";
import { makeLocalConnection } from "./local/LocalRuntime";
import {
  MAX_LOCAL_PROJECT_BYTES,
  makeLocalProjectStore,
  type LocalProjectStatus,
} from "./local/LocalStoragePersistence";

const localUserId = () => {
  const key = "macrograph:local-user";
  const created = randomUUID();
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored;
    localStorage.setItem(key, created);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  return created;
};

const styles = stylex.create({
  root: {
    backgroundColor: colors.gray1,
    color: colors.gray12,
    colorScheme: "dark",
    display: "flex",
    flexDirection: "column",
    fontSize: 14,
    height: "100vh",
    overflow: "hidden",
    width: "100vw",
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "grid",
    gridTemplateColumns: {
      default: "auto minmax(0, 1fr)",
      "@media (min-width: 768px)": "1fr auto 1fr",
    },
    flexShrink: 0,
    columnGap: 8,
    minHeight: 44,
    paddingInline: 12,
  },
  brand: { display: "flex", alignItems: "center", gap: 8, minHeight: 44 },
  logo: { borderRadius: 6, height: 28, width: 28 },
  title: { fontWeight: 600, letterSpacing: "-0.025em" },
  nav: {
    display: "flex",
    alignSelf: "stretch",
    justifySelf: "center",
    gridColumn: { default: "1 / -1", "@media (min-width: 768px)": "2" },
    gridRowStart: { default: 2, "@media (min-width: 768px)": 1 },
  },
  navItem: {
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    paddingBlock: 8,
    paddingInline: 16,
    fontSize: 12,
    fontWeight: 500,
    textTransform: "capitalize",
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    cursor: "pointer",
  },
  navActive: { borderBottomColor: colors.focus, color: colors.gray12 },
  navIdle: {
    borderBottomColor: "transparent",
    color: { default: colors.gray10, ":hover": colors.gray12 },
  },
  controls: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    justifySelf: "end",
    gridRowStart: 1,
    gridColumnStart: -2,
    minWidth: 0,
  },
  reset: {
    backgroundColor: { default: "transparent", ":hover": colors.red3 },
    borderColor: `color-mix(in srgb, ${colors.red9} 60%, transparent)`,
    color: colors.red10,
  },
  status: { flexShrink: 0, fontSize: 12, paddingBlock: 8, paddingInline: 12 },
  errorStatus: { backgroundColor: colors.red4, color: colors.red11 },
  recoveredStatus: {
    backgroundColor: `color-mix(in srgb, ${colors.focus} 24%, transparent)`,
    color: colors.focus,
  },
  main: { flex: 1, minHeight: 0 },
});

export interface PlaygroundHeaderParts {
  /** The editor and events tabs. */
  readonly nav: JSX.Element;
  /** Project settings, export, import, and reset. */
  readonly actions: JSX.Element;
}

/**
 * The browser playground. `header` lets a host page render its own header around the playground's
 * tabs and actions; by default the playground renders a compact one.
 */
export function Playground(props: {
  readonly header?: (parts: PlaygroundHeaderParts) => JSX.Element;
}) {
  const [view, setView] = createSignal<"editor" | "events">("editor");
  const store = makeLocalProjectStore(localStorage);
  const issuer = import.meta.env.VITE_MACROGRAPH_ISSUER;
  const credentials = makeBrowserCredentialProvider({
    storage: localStorage,
    ...(issuer === undefined ? {} : { issuer }),
  });
  const editor = createEditorController({
    connection: credentials.pipe(
      Effect.flatMap((provider) => makeLocalConnection(store, provider)),
      Effect.provide(FetchHttpClient.layer),
    ),
    workspaceId: "local-browser",
    userId: localUserId(),
    settingsDescriptors: discoveredModuleSettings,
    projectSettings: true,
  });
  const [status, setStatus] = createSignal<LocalProjectStatus>();
  const statusMessage = () => {
    const current = status();
    return current === undefined || current.type === "saved" ? "" : current.message;
  };
  let importInput!: HTMLInputElement;

  onSettled(() => {
    const unsubscribe = store.subscribe(setStatus);
    const flush = () => store.flush();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  });

  const exportProject = () => {
    const blob = new Blob([store.exportProject()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "macrograph-local-project.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const importProject = (file: File) => {
    if (!window.confirm("Importing replaces the current local project. Continue?")) return;
    if (file.size > MAX_LOCAL_PROJECT_BYTES) {
      setStatus({
        type: "error",
        message: `The selected project exceeds the ${MAX_LOCAL_PROJECT_BYTES} byte limit.`,
      });
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        if (typeof reader.result !== "string") throw new Error("The selected file is not text.");
        store.importProject(reader.result);
        location.reload();
      } catch (error) {
        setStatus({
          type: "error",
          message: error instanceof Error ? error.message : "The project could not be imported.",
        });
      }
    });
    reader.addEventListener("error", () =>
      setStatus({ type: "error", message: "The selected project file could not be read." }),
    );
    reader.readAsText(file);
  };
  const reset = () => {
    if (!window.confirm("Reset the local project? All graphs and module settings will be deleted."))
      return;
    if (store.reset()) {
      location.reload();
    }
  };
  const controls = () => (
    <div sx={styles.controls}>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          setView("editor");
          editor.openProjectSettings();
        }}
      >
        Settings
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={exportProject}>
        Export
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => importInput.click()}>
        Import
      </Button>
      <Button type="button" size="sm" variant="secondary" sx={styles.reset} onClick={reset}>
        Reset
      </Button>
    </div>
  );

  const nav = () => (
    <nav sx={styles.nav} aria-label="Workspace">
      <For each={["editor", "events"] as const}>
        {(tab) => (
          <button
            type="button"
            sx={[styles.navItem, view() === tab ? styles.navActive : styles.navIdle]}
            aria-current={view() === tab ? "page" : undefined}
            onClick={() => setView(tab)}
          >
            {tab}
          </button>
        )}
      </For>
    </nav>
  );

  const rootAttrs = stylex.attrs(styles.root);

  return (
    <div {...rootAttrs}>
      {props.header === undefined ? (
        <header sx={styles.header}>
          <div sx={styles.brand}>
            <img src={macrographLogo} alt="MacroGraph" sx={styles.logo} />
            <span sx={styles.title}>MacroGraph</span>
          </div>
          {nav()}
          {controls()}
        </header>
      ) : (
        props.header({ nav: nav(), actions: controls() })
      )}
      <input
        ref={importInput}
        style={{ display: "none" }}
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file !== undefined) importProject(file);
        }}
      />
      <Show when={status()?.type === "error" || status()?.type === "recovered"}>
        <div
          sx={[
            styles.status,
            status()?.type === "error" ? styles.errorStatus : styles.recoveredStatus,
          ]}
          role="status"
        >
          {statusMessage()}
        </div>
      </Show>
      <main sx={styles.main}>
        <RealtimeWorkspace
          controller={editor}
          runtimeLabel="Browser"
          view={view()}
          renderProjectSettings={(context) => (
            <CredentialSettings
              client={context.client}
              description={
                <>
                  Authorize this browser to use credentials managed by macrograph.app. Authorization
                  stays in this browser, separate from project exports, imports, and resets.
                </>
              }
              loadingLabel="Loading browser authorization..."
              onChanged={context.refreshModuleData}
            />
          )}
        />
      </main>
    </div>
  );
}
