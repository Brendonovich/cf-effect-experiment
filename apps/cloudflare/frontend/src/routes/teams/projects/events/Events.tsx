import type {
  ProjectEventRecord,
  ProjectExecutionRecord,
  ProjectIngressEventRecord,
} from "@macrograph/cloud-api";

import {
  EventDetailHeader,
  EventExecutionRow,
  EventExecutions,
  EventListItem,
  EventPayload,
  EventSearch,
  EventsLayout,
  EventTimeline,
  LoadingState,
} from "@macrograph/editor-ui";
import { styles } from "@macrograph/editor-ui/events.stylex";
import KofiPlugin from "@macrograph/plugin-kofi";
import TwitchPlugin from "@macrograph/plugin-twitch";
import * as stylex from "@stylexjs/stylex";
import { createQuery } from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";

import type { CredentialsApiClient, EventsApiClient } from "../../../../api";

import { runApi } from "../../../../api";

interface EventsProps {
  readonly projectId: string;
  readonly selectedEventId: string | undefined;
  readonly canViewTraces: boolean;
  readonly api: EventsApiClient;
  readonly credentialsApi: CredentialsApiClient;
  readonly onSelectionChange: (eventId?: string) => void;
}

type TimelineItem =
  | { readonly kind: "ingress"; readonly record: ProjectIngressEventRecord }
  | {
      readonly kind: "event";
      readonly record: ProjectEventRecord;
      readonly ingress?: ProjectIngressEventRecord;
    };

const eventSource = (event: ProjectEventRecord): "Ingress" | "Engine" | "Timer" | "Internal" => {
  switch (event.source) {
    case "ingress":
      return "Ingress";
    case "engine":
      return "Engine";
    case "timer":
      return "Timer";
    case "internal":
      return "Internal";
  }
};

const axiomTraceUrl = (traceId: string, receivedAt: string): string | undefined => {
  const organizationId = import.meta.env.VITE_AXIOM_ORG_ID;
  if (!organizationId) return undefined;

  const timestamp = new Date(receivedAt).getTime();
  const url = new URL(`/${encodeURIComponent(organizationId)}/trace`, "https://app.axiom.co");
  url.searchParams.set("traceId", traceId);
  url.searchParams.set("startTime", new Date(timestamp - 5 * 60 * 1000).toISOString());
  url.searchParams.set("endTime", new Date(timestamp + 5 * 60 * 1000).toISOString());
  if (import.meta.env.VITE_AXIOM_TRACE_DATASET)
    url.searchParams.set("traceDataset", import.meta.env.VITE_AXIOM_TRACE_DATASET);
  return url.href;
};

export const Events: Component<EventsProps> = (props) => {
  const [eventSearch, setEventSearch] = createSignal("");
  const [selectedIngressId, setSelectedIngressId] = createSignal<string>();
  const [ingressSearch, setIngressSearch] = createSignal("");
  const [now, setNow] = createSignal(Date.now());
  createEffect(
    () => true,
    () => {
      const interval = setInterval(() => setNow(Date.now()), 60_000);
      return () => clearInterval(interval);
    },
  );
  const eventQuery = createQuery(() => ({
    queryKey: ["events", props.projectId],
    queryFn: async () => {
      const body = await runApi(props.api.list({ params: { projectId: props.projectId } }));
      if (body === undefined) throw new Error("Could not load event activity");
      return body;
    },
    refetchInterval: 2000,
    staleTime: 2000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  }));

  const credentialsQuery = createQuery(() => ({
    queryKey: ["credentials", props.projectId],
    queryFn: async () => {
      const catalog = await runApi(
        props.credentialsApi.list({ params: { projectId: props.projectId } }),
      );
      if (catalog === undefined) throw new Error("Could not load credentials");
      return catalog;
    },
    retry: false,
  }));
  const credentials = () => {
    const catalog = credentialsQuery.data;
    return catalog?._tag === "CredentialCatalogAvailable" ? catalog.credentials : [];
  };

  const ingressEvents = () => eventQuery.data?.ingressEvents ?? [];
  const ingresses = () => eventQuery.data?.ingresses ?? [];
  const sidebarIngresses = createMemo(() => {
    const search = ingressSearch().trim().toLowerCase();
    return search === ""
      ? ingresses()
      : ingresses().filter((ingress) =>
          [ingress.displayName, ingress.schema.displayName, ingress.id].some((value) =>
            value?.toLowerCase().includes(search),
          ),
        );
  });
  const events = () => eventQuery.data?.events ?? [];
  const executions = () => eventQuery.data?.executions ?? [];
  const selectedIngress = () => ingresses().find((ingress) => ingress.id === selectedIngressId());
  const visibleIngressEvents = () => {
    const endpointId = selectedIngressId();
    return endpointId === undefined
      ? ingressEvents()
      : ingressEvents().filter((event) => event.endpointId === endpointId);
  };
  const visibleEvents = () => {
    const endpointId = selectedIngressId();
    if (endpointId === undefined) return events();
    const ingressIds = new Set(
      ingressEvents()
        .filter((event) => event.endpointId === endpointId)
        .map((event) => event.id),
    );
    return events().filter(
      (event) => event.ingressEventId !== null && ingressIds.has(event.ingressEventId),
    );
  };
  const timeline = createMemo<ReadonlyArray<TimelineItem>>(() => {
    const ingressesById = new Map(visibleIngressEvents().map((ingress) => [ingress.id, ingress]));
    const linkedIngressIds = new Set(
      visibleEvents().flatMap((event) =>
        event.ingressEventId === null ? [] : [event.ingressEventId],
      ),
    );

    return [
      ...visibleIngressEvents()
        .filter((record) => !linkedIngressIds.has(record.id))
        .map((record): TimelineItem => ({ kind: "ingress", record })),
      ...visibleEvents().map((record): TimelineItem => {
        const ingress =
          record.ingressEventId === null ? undefined : ingressesById.get(record.ingressEventId);
        return {
          kind: "event",
          record,
          ...(ingress === undefined ? {} : { ingress }),
        };
      }),
    ].sort((left, right) => right.record.receivedAt.localeCompare(left.record.receivedAt));
  });
  const filteredTimeline = createMemo(() => {
    const search = eventSearch().trim().toLowerCase();
    return search === ""
      ? timeline()
      : timeline().filter((item) =>
          [item.record.eventType, item.record.pluginId, item.record.id].some((value) =>
            value.toLowerCase().includes(search),
          ),
        );
  });
  const selectedItem = (): TimelineItem | undefined => {
    const event = events().find((record) => record.id === props.selectedEventId);
    if (event !== undefined) {
      const ingress = ingressEvents().find((record) => record.id === event.ingressEventId);
      return {
        kind: "event",
        record: event,
        ...(ingress === undefined ? {} : { ingress }),
      };
    }

    const ingress = ingressEvents().find((record) => record.id === props.selectedEventId);
    return ingress === undefined ? undefined : { kind: "ingress", record: ingress };
  };
  const toggleIngress = (endpointId: string) => {
    setSelectedIngressId((selected) => (selected === endpointId ? undefined : endpointId));
  };
  const IngressEndpoint: Component<{
    readonly ingress: ReturnType<typeof ingresses>[number];
  }> = (endpointProps) => (
    <div>
      <div sx={styles.betweenStart}>
        <div sx={styles.minWidth}>
          <div
            sx={styles.handler}
            title={
              credentials().find(
                (credential) =>
                  credential.provider === "twitch" &&
                  credential.id === endpointProps.ingress.instanceKey,
              )?.displayName ??
              endpointProps.ingress.displayName ??
              endpointProps.ingress.schema.displayName
            }
          >
            {credentials().find(
              (credential) =>
                credential.provider === "twitch" &&
                credential.id === endpointProps.ingress.instanceKey,
            )?.displayName ??
              endpointProps.ingress.displayName ??
              endpointProps.ingress.schema.displayName}
          </div>
          <div sx={styles.instance}>
            {endpointProps.ingress.schema.displayName} ·{" "}
            {[KofiPlugin, TwitchPlugin].find((plugin) =>
              endpointProps.ingress.schema.id.startsWith(`${plugin.id}:`),
            )?.name ?? endpointProps.ingress.schema.id.split(":")[0]}
          </div>
        </div>
        <div sx={styles.badges}>
          <Show when={endpointProps.ingress.deployed}>
            <span sx={[styles.badge, styles.deployed]}>Deployed</span>
          </Show>
          <Show when={endpointProps.ingress.preview}>
            <span sx={[styles.badge, styles.preview]}>Preview</span>
          </Show>
        </div>
      </div>
      <div sx={[styles.endpointId, styles.inlineEndpointId]} title={endpointProps.ingress.id}>
        {endpointProps.ingress.id}
      </div>
    </div>
  );

  return (
    <EventsLayout
      sidebar={
        <section sx={styles.ingressPanel}>
          <header sx={styles.ingressPanelHeader}>
            <div sx={styles.timelineHeaderTitle}>
              <div sx={styles.titleRow}>
                <h1 sx={[styles.panelTitle, styles.timelineHeading]}>Ingress endpoints</h1>
                <Show when={eventQuery.data !== undefined}>
                  <span sx={styles.executionCount}>{ingresses().length}</span>
                </Show>
              </div>
              <p sx={styles.panelDescription}>Deployment and preview endpoint state</p>
            </div>
            <EventSearch
              ingress
              placeholder="Search endpoints"
              value={ingressSearch()}
              onChange={setIngressSearch}
            />
          </header>
          <div sx={[styles.scrollBody, styles.flushIngressList, styles.ingressScrollBody]}>
            <Show
              when={sidebarIngresses().length > 0}
              fallback={
                <Show
                  when={!eventQuery.isPending}
                  fallback={
                    <div sx={styles.skeleton} role="status">
                      <div sx={styles.skeletonTitle} />
                      <div sx={styles.skeletonLine} />
                      <div sx={styles.skeletonShort} />
                    </div>
                  }
                >
                  <div sx={styles.emptyIngress}>
                    {ingresses().length > 0
                      ? "No ingress endpoints match your search."
                      : "No ingress endpoints are deployed or in preview."}
                  </div>
                </Show>
              }
            >
              <div sx={styles.buttonList}>
                <For each={sidebarIngresses()}>
                  {(ingress) => (
                    <button
                      sx={[
                        styles.listButton,
                        selectedIngressId() === ingress.id
                          ? styles.selectedSidebarAccent
                          : styles.ingressSidebarUnselected,
                        selectedIngressId() === ingress.id && styles.ingressSidebarSelectedHover,
                      ]}
                      onClick={() => toggleIngress(ingress.id)}
                    >
                      <IngressEndpoint ingress={ingress} />
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </section>
      }
    >
      <EventTimeline
        description="Ingress and runtime events"
        search={eventSearch()}
        onSearch={setEventSearch}
        searchPlaceholder={
          selectedIngress() === undefined
            ? "Search events"
            : `Search ${
                credentials().find(
                  (credential) =>
                    credential.provider === "twitch" &&
                    credential.id === selectedIngress()?.instanceKey,
                )?.displayName ??
                selectedIngress()?.displayName ??
                selectedIngress()?.schema.displayName
              } (${selectedIngress()?.schema.displayName}) events`
        }
        onRefresh={() => void eventQuery.refetch()}
        loading={eventQuery.isPending}
        error={eventQuery.error?.message ?? ""}
        empty={filteredTimeline().length === 0}
        emptyDescription={
          selectedIngressId() === undefined
            ? "Ingress and runtime events will appear here."
            : "No events have been received by this ingress."
        }
      >
        <For each={filteredTimeline()}>
          {(item) => (
            <EventListItem
              id={item.record.id}
              name={item.record.eventType}
              pluginName={
                [KofiPlugin, TwitchPlugin].find((plugin) => plugin.id === item.record.pluginId)
                  ?.name ?? item.record.pluginId
              }
              source={item.kind === "event" ? eventSource(item.record) : "Ingress"}
              receivedAt={item.record.receivedAt}
              now={now()}
              selected={props.selectedEventId === item.record.id}
              onSelect={() => props.onSelectionChange(item.record.id)}
            />
          )}
        </For>
      </EventTimeline>

      <section sx={styles.detailPanel}>
        <Show
          when={!eventQuery.isPending}
          fallback={<LoadingState label="Loading event activity" style={styles.fullHeight} />}
        >
          <Show
            when={selectedItem()}
            fallback={
              <div sx={styles.detailEmpty}>
                <div sx={styles.detailEmptyText}>
                  {props.selectedEventId === undefined ? "Select an event" : "Event not found"}
                </div>
              </div>
            }
          >
            {(item) => {
              const ingressDetails = createMemo(() => {
                const selected = item();
                const ingress = selected.kind === "ingress" ? selected.record : selected.ingress;
                const endpoint =
                  ingress === undefined
                    ? undefined
                    : ingresses().find((candidate) => candidate.id === ingress.endpointId);
                const ingressName =
                  endpoint === undefined
                    ? undefined
                    : `${endpoint.schema.displayName} · ${endpoint.displayName}`;
                const pluginName =
                  [KofiPlugin, TwitchPlugin].find(
                    (plugin) => plugin.id === selected.record.pluginId,
                  )?.name ?? selected.record.pluginId;

                return {
                  name: ingressName === undefined ? pluginName : `${pluginName} · ${ingressName}`,
                  id: ingress?.endpointId,
                  endpoint,
                };
              });
              const eventExecutions = createMemo<ReadonlyArray<ProjectExecutionRecord>>(() =>
                item().kind === "event"
                  ? executions().filter(
                      (execution) => execution.projectEventId === item().record.id,
                    )
                  : [],
              );
              const payload = createMemo(() => JSON.stringify(item().record.eventPayload, null, 2));
              const source = createMemo(() => {
                const selected = item();
                return selected.kind === "event" ? eventSource(selected.record) : "Ingress";
              });
              const traceUrl = createMemo(() => {
                const selected = item();
                const ingress = selected.kind === "ingress" ? selected.record : selected.ingress;
                return ingress?.traceId == null
                  ? undefined
                  : axiomTraceUrl(ingress.traceId, ingress.receivedAt);
              });
              return (
                <div sx={styles.detail}>
                  <EventDetailHeader
                    id={item().record.id}
                    name={item().record.eventType}
                    receivedAt={item().record.receivedAt}
                    now={now()}
                  >
                    <Show when={props.canViewTraces && traceUrl()}>
                      {(href) => (
                        <a
                          sx={[styles.receivedTime, styles.link]}
                          href={href()}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Trace
                          <IconTablerExternalLink {...stylex.attrs(styles.traceIcon)} />
                        </a>
                      )}
                    </Show>
                  </EventDetailHeader>

                  <div sx={styles.detailBody}>
                    <EventPayload eventId={item().record.id} source={source()} payload={payload()}>
                      <Show
                        when={ingressDetails().endpoint}
                        fallback={
                          <>
                            <span sx={styles.fieldValue} title={ingressDetails().name}>
                              {ingressDetails().name}
                            </span>
                            <Show when={ingressDetails().id}>
                              {(id) => (
                                <span
                                  sx={[
                                    styles.runDeployment,
                                    styles.ingressId,
                                    styles.inlineFallbackId,
                                  ]}
                                  title={id()}
                                >
                                  {id()}
                                </span>
                              )}
                            </Show>
                          </>
                        }
                      >
                        {(endpoint) => <IngressEndpoint ingress={endpoint()} />}
                      </Show>
                    </EventPayload>

                    <EventExecutions
                      count={eventExecutions().length}
                      emptyDescription="This event did not trigger any executions."
                    >
                      <For each={eventExecutions()}>
                        {(execution, index) => (
                          <EventExecutionRow
                            number={index() + 1}
                            status={execution.status}
                            target={execution.deploymentId}
                            startedAt={execution.startedAt}
                          >
                            <Show when={execution.error}>
                              {(error) => <div sx={styles.runError}>{error()}</div>}
                            </Show>
                          </EventExecutionRow>
                        )}
                      </For>
                    </EventExecutions>
                  </div>
                </div>
              );
            }}
          </Show>
        </Show>
      </section>
    </EventsLayout>
  );
};
