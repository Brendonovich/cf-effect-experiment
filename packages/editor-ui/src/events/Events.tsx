import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, Show } from "solid-js";

import { searchMarker } from "./events-markers.stylex";
import { styles } from "./events.stylex";

export type EventSource = "Ingress" | "Engine" | "Timer" | "Internal";

const formatEventDate = (value: string | number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));

const formatRelativeDate = (value: string | number, now: number) => {
  const timestamp = new Date(value).getTime();
  if (Math.abs(timestamp - now) < 60_000) return timestamp > now ? "soon" : "just now";
  const minutes = Math.round((timestamp - now) / 60_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
};

function SourceBadge(props: { readonly source: EventSource }) {
  return (
    <span
      sx={[
        styles.badge,
        props.source === "Ingress" && styles.ingressSource,
        props.source === "Engine" && styles.engineSource,
        props.source === "Timer" && styles.timerSource,
        props.source === "Internal" && styles.internalSource,
      ]}
    >
      {props.source}
    </span>
  );
}

export function EventsLayout(props: {
  readonly sidebar?: JSX.Element;
  readonly children: JSX.Element;
}) {
  const sidebar = createMemo(() => props.sidebar);
  return (
    <div sx={styles.root} aria-label="Runtime events">
      <div sx={[styles.layout, !sidebar() && styles.runtimeLayout]}>
        {sidebar()}
        {props.children}
      </div>
    </div>
  );
}

export function EventSearch(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string | undefined;
  readonly ingress?: boolean;
}) {
  return (
    <div sx={[searchMarker, props.ingress ? styles.ingressSearchBar : styles.eventSearch]}>
      <IconTablerSearch
        {...stylex.attrs(props.ingress ? styles.ingressSearchIcon : styles.eventSearchIcon)}
      />
      <input
        sx={props.ingress ? styles.ingressSearchInput : styles.eventSearchInput}
        aria-label={props.ingress ? "Search ingress endpoints" : "Search events"}
        placeholder={props.placeholder ?? "Search events"}
        value={props.value}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
      <Show when={props.value}>
        <button
          type="button"
          sx={styles.searchClear}
          aria-label={props.ingress ? "Clear ingress endpoint search" : "Clear event search"}
          onClick={() => props.onChange("")}
        >
          <IconBiX {...stylex.attrs(styles.searchClearIcon)} />
        </button>
      </Show>
    </div>
  );
}

export function EventTimeline(props: {
  readonly description: string;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly searchPlaceholder?: string | undefined;
  readonly onRefresh: () => void;
  readonly loading: boolean;
  readonly error?: string | undefined;
  readonly empty: boolean;
  readonly emptyDescription: string;
  readonly children: JSX.Element;
}) {
  return (
    <section sx={styles.timelinePanel} aria-label="Event list">
      <header sx={[styles.panelHeader, styles.timelineHeader]}>
        <div sx={[styles.betweenStart, styles.gap16, styles.timelineHeaderTitle]}>
          <div>
            <div sx={styles.titleRow}>
              <h1 sx={[styles.panelTitle, styles.timelineHeading]}>Events</h1>
            </div>
            <p sx={styles.panelDescription}>{props.description}</p>
          </div>
          <button type="button" sx={styles.refresh} onClick={props.onRefresh}>
            Refresh
          </button>
        </div>
        <EventSearch
          value={props.search}
          onChange={props.onSearch}
          placeholder={props.searchPlaceholder}
        />
      </header>
      <div sx={[styles.scrollBody, styles.flushIngressList, styles.flushTimelineTop]}>
        <Show when={props.error}>
          {(error) => (
            <div sx={styles.error} role="alert">
              {error()}
            </div>
          )}
        </Show>
        <Show
          when={!props.loading}
          fallback={
            <div sx={styles.skeleton} role="status" aria-label="Loading event activity">
              <div sx={styles.skeletonTitle} />
              <div sx={styles.skeletonLine} />
              <div sx={styles.skeletonShort} />
            </div>
          }
        >
          <Show
            when={!props.empty}
            fallback={
              <div sx={styles.emptyTimeline}>
                <div sx={styles.emptyTitle}>No event activity</div>
                <div sx={styles.panelDescription}>{props.emptyDescription}</div>
              </div>
            }
          >
            {props.children}
          </Show>
        </Show>
      </div>
    </section>
  );
}

export function EventListItem(props: {
  readonly id: string;
  readonly name: string;
  readonly pluginName: string;
  readonly source: EventSource;
  readonly receivedAt: string | number;
  readonly now: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      sx={[styles.listButton, props.selected ? styles.selected : styles.unselected]}
      aria-pressed={props.selected ? "true" : "false"}
      onClick={props.onSelect}
    >
      <div sx={styles.betweenCenter}>
        <div sx={[styles.titleRow, styles.minWidth]}>
          <span sx={styles.eventName}>{props.name}</span>
          <span sx={styles.instance}>{props.pluginName}</span>
        </div>
        <SourceBadge source={props.source} />
      </div>
      <div sx={styles.eventMeta}>
        <span sx={styles.truncateMono}>{props.id}</span>
        <span style={{ "flex-shrink": "0" }} title={formatEventDate(props.receivedAt)}>
          {formatRelativeDate(props.receivedAt, props.now)}
        </span>
      </div>
    </button>
  );
}

export function EventDetailHeader(props: {
  readonly id: string;
  readonly name: string;
  readonly receivedAt: string | number;
  readonly now: number;
  readonly children?: JSX.Element;
}) {
  const [tooltipVisible, setTooltipVisible] = createSignal(false);
  createEffect(
    () => props.id,
    () => {
      setTooltipVisible(false);
    },
  );
  return (
    <header sx={styles.detailHeader}>
      <div sx={[styles.titleRow, styles.detailHeaderRow, styles.minWidth, styles.gap16]}>
        <h2 sx={styles.detailTitle}>{props.name}</h2>
        <span sx={[styles.runDeployment, styles.ingressId, styles.detailEventId]} title={props.id}>
          {props.id}
        </span>
      </div>
      <div sx={styles.detailMeta}>
        <div sx={[styles.titleRow, styles.detailHeaderRow, styles.gap16]}>
          {props.children}
          <span
            sx={[styles.receivedTime, styles.receivedTimeTooltipTrigger]}
            tabindex={0}
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
            onFocusIn={() => setTooltipVisible(true)}
            onFocusOut={() => setTooltipVisible(false)}
          >
            {formatRelativeDate(props.receivedAt, props.now)}
            <span
              sx={[
                styles.receivedTimeTooltip,
                tooltipVisible() && styles.receivedTimeTooltipVisible,
              ]}
              role="tooltip"
            >
              {formatEventDate(props.receivedAt)}
            </span>
          </span>
        </div>
      </div>
    </header>
  );
}

export function EventPayload(props: {
  readonly eventId: string;
  readonly source: EventSource;
  readonly payload: string;
  readonly children: JSX.Element;
}) {
  const [copyState, setCopyState] = createSignal<"idle" | "copied" | "failed">("idle");
  createEffect(
    () => props.eventId,
    () => {
      setCopyState("idle");
    },
  );
  const copyPayload = async () => {
    const id = props.eventId;
    try {
      await navigator.clipboard.writeText(props.payload);
      if (props.eventId === id) setCopyState("copied");
    } catch {
      if (props.eventId === id) setCopyState("failed");
    }
  };
  return (
    <section sx={styles.payload}>
      <div sx={styles.betweenCenter}>
        <h3 sx={styles.payloadTitle}>Source</h3>
        <SourceBadge source={props.source} />
      </div>
      <div sx={styles.fields}>{props.children}</div>
      <h3 sx={[styles.payloadTitle, styles.payloadHeading]}>Payload</h3>
      <div sx={styles.payloadBlock}>
        <pre sx={styles.pre}>{props.payload}</pre>
        <button
          type="button"
          sx={styles.copy}
          aria-label={copyState() === "copied" ? "Copied JSON" : "Copy JSON"}
          title={copyState() === "copied" ? "Copied JSON" : "Copy JSON"}
          onClick={() => void copyPayload()}
        >
          <IconTablerCopy {...stylex.attrs(styles.copyIcon)} />
        </button>
      </div>
      <Show when={copyState() === "failed"}>
        <p sx={styles.runError} role="status">
          Clipboard unavailable. Select the payload to copy it manually.
        </p>
      </Show>
    </section>
  );
}

export function EventExecutions(props: {
  readonly count: number;
  readonly emptyDescription: string;
  readonly children: JSX.Element;
}) {
  return (
    <section sx={styles.executions}>
      <div sx={styles.titleRow}>
        <h3 sx={styles.payloadTitle}>Executions</h3>
        <span sx={styles.executionCount}>{props.count}</span>
      </div>
      <div sx={styles.executionRows}>
        <Show
          when={props.count > 0}
          fallback={<div sx={styles.emptyExecutions}>{props.emptyDescription}</div>}
        >
          {props.children}
        </Show>
      </div>
    </section>
  );
}

export function EventExecutionRow(props: {
  readonly number: number;
  readonly id?: string | undefined;
  readonly status: string;
  readonly statusDescription?: string | undefined;
  readonly target: string;
  readonly startedAt?: string | number | null | undefined;
  readonly children?: JSX.Element;
}) {
  return (
    <div sx={styles.executionRow}>
      <div sx={[styles.betweenCenter, styles.minWidth]}>
        <span sx={styles.runNumber} title={props.id}>
          #{props.number}
        </span>
        <span sx={styles.runStatus} title={props.statusDescription}>
          {props.status}
        </span>
      </div>
      <div sx={styles.runDeployment} title={props.target}>
        {props.target}
      </div>
      <Show when={props.startedAt != null}>
        <span sx={styles.runTime}>{formatEventDate(props.startedAt ?? 0)}</span>
      </Show>
      {props.children}
    </div>
  );
}
