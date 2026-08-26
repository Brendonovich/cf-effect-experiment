import type { RuntimeActivity } from "@macrograph/execution";

import { createMemo, createSignal, For, Show } from "solid-js";

import { activityExecutions } from "./activity";
import { createClock } from "./createClock";
import {
  EventDetailHeader,
  EventExecutionRow,
  EventExecutions,
  EventListItem,
  EventPayload,
  EventsLayout,
  EventTimeline,
} from "./Events";
import { styles } from "./events.stylex";
import { LoadingState } from "../ui/LoadingState";

export interface LiveEventsProps {
  readonly events: ReadonlyArray<RuntimeActivity.Event>;
  readonly packages?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly state: "connecting" | "live" | "error";
  readonly error: string;
  readonly onRetry: () => void;
}

export function LiveEvents(props: LiveEventsProps) {
  const [search, setSearch] = createSignal("");
  const [selectedId, setSelectedId] = createSignal<string>();
  const now = createClock();
  const filtered = createMemo(() => {
    const query = search().trim().toLowerCase();
    return props.events.filter(
      (event) =>
        query === "" ||
        [event.name, event.pluginId, event.id].some((value) => value.toLowerCase().includes(query)),
    );
  });
  const byId = createMemo(() => new Map(props.events.map((event) => [event.id, event])));
  const selected = createMemo(() => byId().get(selectedId() ?? ""));
  const executions = createMemo(() => activityExecutions(selected()?.nodes ?? []));
  const pluginName = (id: string) => props.packages?.find((pkg) => pkg.id === id)?.name ?? id;
  const payload = createMemo(() => {
    const value = selected()?.payload ?? "";
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  });

  return (
    <EventsLayout>
      <EventTimeline
        description="Runtime events"
        search={search()}
        onSearch={setSearch}
        onRefresh={props.onRetry}
        loading={props.state === "connecting"}
        error={props.state === "error" ? props.error : undefined}
        empty={filtered().length === 0}
        emptyDescription="Runtime events will appear here."
      >
        <For each={filtered().map((event) => event.id)}>
          {(id) => (
            <EventListItem
              id={id}
              name={byId().get(id)?.name ?? ""}
              pluginName={pluginName(byId().get(id)?.pluginId ?? "")}
              source="Engine"
              receivedAt={byId().get(id)?.startedAt ?? 0}
              now={now()}
              selected={selectedId() === id}
              onSelect={() => setSelectedId(id)}
            />
          )}
        </For>
      </EventTimeline>

      <section sx={styles.detailPanel}>
        <Show
          when={props.state !== "connecting"}
          fallback={<LoadingState label="Loading event activity" style={styles.fullHeight} />}
        >
          <Show
            when={selected()}
            fallback={
              <div sx={styles.detailEmpty}>
                <div sx={styles.detailEmptyText}>
                  {selectedId() === undefined ? "Select an event" : "Event not found"}
                </div>
              </div>
            }
          >
            {(event) => (
              <div sx={styles.detail}>
                <EventDetailHeader
                  id={event().id}
                  name={event().name}
                  receivedAt={event().startedAt}
                  now={now()}
                />
                <Show when={event().error}>
                  {(error) => <div sx={styles.error}>{error()}</div>}
                </Show>

                <div sx={styles.detailBody}>
                  <EventPayload eventId={event().id} source="Engine" payload={payload()}>
                    <span sx={styles.fieldValue} title={pluginName(event().pluginId)}>
                      {pluginName(event().pluginId)}
                    </span>
                  </EventPayload>

                  <EventExecutions
                    count={executions().length}
                    emptyDescription={
                      event().status === "running"
                        ? "Waiting for execution activity."
                        : event().status === "complete"
                          ? "This event did not trigger any executions."
                          : "No execution activity was recorded."
                    }
                  >
                    <For each={executions()}>
                      {(execution, index) => {
                        const status = createMemo(() =>
                          execution.nodes.some((node) => node.status === "failed")
                            ? "failed"
                            : execution.nodes.some((node) => node.status === "interrupted")
                              ? "interrupted"
                              : execution.nodes.some((node) => node.status === "running")
                                ? "running"
                                : "complete",
                        );
                        return (
                          <EventExecutionRow
                            number={index() + 1}
                            id={execution.id}
                            status={`nodes ${status()}`}
                            statusDescription="Status of recorded nodes, not the full execution"
                            target={execution.graphId}
                            startedAt={Math.min(...execution.nodes.map((node) => node.startedAt))}
                          >
                            <For each={execution.nodes.filter((node) => node.error !== null)}>
                              {(node) => <div sx={styles.runError}>{node.error}</div>}
                            </For>
                          </EventExecutionRow>
                        );
                      }}
                    </For>
                  </EventExecutions>
                </div>
              </div>
            )}
          </Show>
        </Show>
      </section>
    </EventsLayout>
  );
}
