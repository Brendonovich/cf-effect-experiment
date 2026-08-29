import type { RuntimeActivity } from "@macrograph/execution";

import * as stylex from "@stylexjs/stylex";
import { Cause, Effect, Fiber, Stream } from "effect";
import { createEffect, createMemo, createSignal, Show } from "solid-js";

import { LiveEvents } from "../events/LiveEvents";
import { runFork } from "../observability/browserTracing";
import { colors } from "../tokens.stylex";
import { Editor, type EditorProps } from "./Editor";

/** A single live editor connection survives navigation to events and settings. */
export function RealtimeWorkspace(
  props: EditorProps & {
    readonly runtimeLabel: string;
    readonly view?: "editor" | "events" | "settings";
  },
) {
  const view = createMemo(() => props.view ?? "editor");
  const [events, setEvents] = createSignal<ReadonlyArray<RuntimeActivity.Event>>([]);
  const [activityState, setActivityState] = createSignal<"connecting" | "live" | "error">(
    "connecting",
  );
  const [error, setError] = createSignal("");
  const [retry, setRetry] = createSignal(0);

  createEffect(
    () => ({ connection: props.controller.connection.activeConnection(), retry: retry() }),
    ({ connection }) => {
      setEvents([]);
      setError("");
      setActivityState("connecting");
      if (connection === null) return;
      if (connection.activity === undefined) {
        setError("This runtime does not provide event activity.");
        setActivityState("error");
        return;
      }
      let active = true;
      const fiber = runFork(
        connection.activity.pipe(
          Stream.runForEach((snapshot) =>
            Effect.sync(() => {
              if (!active) return;
              setEvents(snapshot);
              setActivityState("live");
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              if (!active) return;
              const failure = Cause.squash(cause);
              const forbidden =
                typeof failure === "object" &&
                failure !== null &&
                "_tag" in failure &&
                failure._tag === "EditorForbidden";
              setError(
                forbidden
                  ? "Sign in as the server owner or an administrator to view runtime events."
                  : "The event stream is unavailable. Check your connection and access, then retry.",
              );
              setActivityState("error");
            }),
          ),
        ),
      );
      return () => {
        active = false;
        runFork(Fiber.interrupt(fiber));
      };
    },
  );

  return (
    <div sx={styles.root}>
      <div hidden={view() !== "editor"} sx={[styles.panel, view() !== "editor" && styles.hidden]}>
        <Editor {...props} />
      </div>
      <div sx={[styles.panel, view() !== "events" && styles.hidden]}>
        <LiveEvents
          events={events()}
          packages={props.controller.editor.store.packages}
          state={activityState()}
          error={error()}
          onRetry={() => setRetry((value) => value + 1)}
          onReplay={
            props.controller.connection.canEdit()
              ? props.controller.connection.activeConnection()?.replayEvent
              : undefined
          }
        />
      </div>
      <Show when={view() === "settings"}>
        <section sx={styles.settings} aria-label="Project settings">
          <div sx={styles.settingsContent}>
            <h1 sx={styles.heading}>Project settings</h1>
            <p sx={styles.description}>Configuration changes apply to this runtime immediately.</p>
            {props.renderProjectSettings?.({
              client: props.controller.connection.client,
              refreshPluginData: props.controller.refreshPluginData,
            })}
          </div>
        </section>
      </Show>
    </div>
  );
}

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  panel: { flex: 1, minHeight: 0 },
  hidden: { display: "none" },
  settings: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: { default: 16, "@media (min-width: 768px)": 32 },
  },
  settingsContent: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 960,
    marginInline: "auto",
  },
  heading: { margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.025em" },
  description: { margin: 0, fontSize: 12, color: colors.gray10 },
});
