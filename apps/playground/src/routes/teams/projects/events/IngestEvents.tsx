import { createQuery } from "@tanstack/solid-query";
import { For, Show, type Component } from "solid-js";

import type { IngressEventsApiClient } from "../../../../api";

import { runApi } from "../../../../api";
import { LoadingState } from "../../../../LoadingState";

interface IngestEventsProps {
  readonly projectId: string;
  readonly selectedEventId: string | undefined;
  readonly api: IngressEventsApiClient;
  readonly onSelectionChange: (eventId?: string) => void;
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));

export const IngestEvents: Component<IngestEventsProps> = (props) => {
  const eventQuery = createQuery(() => ({
    queryKey: ["ingress-events", props.projectId],
    queryFn: async () => {
      const body = await runApi(props.api.list({ params: { projectId: props.projectId } }));
      if (body === undefined) throw new Error("Could not load ingest history");
      return body.events;
    },
    refetchInterval: 2000,
    staleTime: 2000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  }));

  const events = () => eventQuery.data ?? [];
  const selectedEvent = () => events().find((event) => event.id === props.selectedEventId);

  return (
    <div class="flex h-full min-h-0 bg-gray-2 text-gray-12">
      <section class="flex w-[400px] shrink-0 flex-col border-r border-gray-5 bg-gray-3">
        <header class="shrink-0 border-b border-gray-5 px-5 py-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <span class="relative flex size-2">
                  <span class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span class="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <h1 class="text-sm font-semibold">Live ingest</h1>
              </div>
              <p class="mt-1 text-xs text-gray-11">Decoded events, with or without a revision</p>
            </div>
            <button
              class="rounded border border-gray-5 px-2 py-1 text-[10px] font-medium text-gray-11 hover:bg-gray-2 hover:text-gray-12"
              onClick={() => void eventQuery.refetch()}
            >
              Refresh
            </button>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <Show when={eventQuery.error?.message}>
            {(message) => (
              <div class="m-2 rounded border border-red-7 bg-red-3 p-3 text-xs text-red-11">
                {message()}
              </div>
            )}
          </Show>
          <Show
            when={!eventQuery.isPending}
            fallback={
              <div
                class="m-2 space-y-2 rounded-lg border border-dashed border-gray-6 p-6"
                role="status"
                aria-label="Loading ingest history"
              >
                <div class="h-5 w-32 animate-pulse rounded bg-gray-5" />
                <div class="h-3 w-full animate-pulse rounded bg-gray-4" />
                <div class="h-3 w-3/4 animate-pulse rounded bg-gray-4" />
              </div>
            }
          >
            <Show
              when={events().length > 0}
              fallback={
                <div class="m-2 rounded-lg border border-dashed border-gray-6 p-6 text-center">
                  <div class="text-sm font-medium text-gray-12">No events received</div>
                  <div class="mt-1 text-xs leading-relaxed text-gray-11">
                    Successfully decoded endpoint events will appear here.
                  </div>
                </div>
              }
            >
              <For each={events()}>
                {(event) => (
                  <button
                    class={`mb-1 w-full rounded-lg border px-3 py-3 text-left transition ${
                      props.selectedEventId === event.id
                        ? "border-blue-500 bg-blue-500/15"
                        : "border-transparent hover:border-gray-5 hover:bg-gray-2"
                    }`}
                    onClick={() => props.onSelectionChange(event.id)}
                  >
                    <div class="flex items-center justify-between gap-3">
                      <span class="truncate text-xs font-semibold text-gray-12">
                        {event.eventType}
                      </span>
                      <span class="shrink-0 rounded bg-gray-2 px-1.5 py-0.5 font-mono text-[9px] text-gray-11">
                        {event.pluginId}
                      </span>
                    </div>
                    <div class="mt-2 flex items-center justify-between gap-2 text-[10px] text-gray-11">
                      <span class="truncate font-mono">{event.eventId ?? event.id}</span>
                      <span class="shrink-0">{formatDate(event.receivedAt)}</span>
                    </div>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>
        <div class="shrink-0 border-t border-gray-5 px-4 py-2 text-[10px] text-gray-11">
          <Show
            when={!eventQuery.isPending}
            fallback={
              <span
                class="inline-block h-3 w-24 animate-pulse rounded bg-gray-4"
                role="status"
                aria-label="Loading latest events"
              />
            }
          >
            <span>
              Latest {events().length} event{events().length === 1 ? "" : "s"}
            </span>
          </Show>{" "}
          · updates every 2 seconds
        </div>
      </section>

      <section class="min-w-0 flex-1 overflow-y-auto">
        <Show
          when={!eventQuery.isPending}
          fallback={<LoadingState label="Loading event" class="h-full" />}
        >
          <Show
            when={selectedEvent()}
            keyed
            fallback={
              <div class="grid h-full place-items-center p-8 text-center">
                <div class="text-sm font-medium text-gray-11">
                  {props.selectedEventId === undefined ? "Select an event" : "Event not found"}
                </div>
              </div>
            }
          >
            {(event) => (
              <div class="mx-auto max-w-5xl p-6 lg:p-10">
                <div class="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-11">
                  Ingest event
                </div>
                <div class="flex items-start justify-between gap-6">
                  <div class="min-w-0">
                    <h2 class="truncate text-xl font-semibold tracking-tight">{event.eventType}</h2>
                    <div class="mt-2 font-mono text-[10px] text-gray-11">{event.id}</div>
                  </div>
                  <span class="shrink-0 rounded-md bg-emerald-400/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                    Received
                  </span>
                </div>

                <dl class="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-5 bg-gray-5 lg:grid-cols-4">
                  <For
                    each={[
                      ["Received", formatDate(event.receivedAt)],
                      ["Plugin", event.pluginId],
                      ["Provider event ID", event.eventId ?? "Not provided"],
                      ["Endpoint", event.endpointId],
                    ]}
                  >
                    {([label, value]) => (
                      <div class="min-w-0 bg-gray-1 p-4">
                        <dt class="text-[10px] font-semibold uppercase tracking-wider text-gray-11">
                          {label}
                        </dt>
                        <dd class="mt-1 truncate font-mono text-xs text-gray-12" title={value}>
                          {value}
                        </dd>
                      </div>
                    )}
                  </For>
                </dl>

                <section class="mt-8 min-w-0">
                  <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-11">
                    Payload
                  </h3>
                  <pre class="mt-3 max-h-[620px] overflow-auto rounded-lg bg-gray-1 p-4 text-[11px] leading-relaxed text-gray-12 shadow-sm">
                    {JSON.stringify(event.eventPayload, null, 2)}
                  </pre>
                </section>
              </div>
            )}
          </Show>
        </Show>
      </section>
    </div>
  );
};
