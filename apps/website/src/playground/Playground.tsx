import { CloudCredentials } from "@macrograph/cloud-credentials";
import { randomUUID } from "@macrograph/editor";
import {
  Button,
  createEditorController,
  createModuleUILoader,
  RealtimeWorkspace,
} from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/solid-query";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { createSignal, For, onSettled, Show } from "solid-js";

import { getSession, sessionKey } from "../api";
import { Header } from "../Header";
import { makeLocalConnection, type LocalEditorConnection } from "./local/LocalRuntime";
import {
  MAX_LOCAL_PROJECT_BYTES,
  makeLocalProjectStore,
  type LocalProjectStatus,
} from "./local/LocalStoragePersistence";
import { moduleUIs } from "./local/ModuleUIs";

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
  nav: { display: "flex", alignSelf: "stretch" },
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

/** The browser playground, run on local storage with the signed-in user's credentials. */
export function Playground() {
  const [view, setView] = createSignal<"editor" | "events">("editor");
  const store = makeLocalProjectStore(localStorage);
  const queryClient = useQueryClient();
  const editor = createEditorController({
    connection: CloudCredentials.makeSession({
      // If the session can't be checked, the credentials request decides.
      signedIn: Effect.tryPromise(() =>
        queryClient.fetchQuery({ queryKey: sessionKey, queryFn: getSession, staleTime: 60_000 }),
      ).pipe(
        Effect.map((session) => session !== null),
        Effect.orElseSucceed(() => true),
      ),
    }).pipe(
      Effect.flatMap((provider) => makeLocalConnection(store, provider)),
      Effect.provide(FetchHttpClient.layer),
    ),
    workspaceId: "local-browser",
    userId: localUserId(),
    modules: {
      catalog: (connection: LocalEditorConnection) => connection.moduleCatalog,
      loader: createModuleUILoader({ static: moduleUIs }),
      rpcProtocol: (connection: LocalEditorConnection) => connection.moduleRpcProtocol,
    },
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
      <Header nav={nav()} actions={controls()} />
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
        <RealtimeWorkspace controller={editor} runtimeLabel="Browser" view={view()} />
      </main>
    </div>
  );
}
