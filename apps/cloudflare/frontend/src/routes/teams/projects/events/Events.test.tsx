// @vitest-environment jsdom
import {
  DeploymentNotFound,
  EventNotFound,
  ProjectNotFound,
  type ProjectEventRecord,
  type ProjectExecutionRecord,
  type ProjectIngressEventRecord,
} from "@macrograph/cloud-api";
import { render } from "@solidjs/web";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { Effect } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

import type { CredentialsApiClient, EventsApiClient } from "../../../../api";

import { Events } from "./Events";

vi.mock("@macrograph/editor-ui", async () => ({
  ...(await import("../../../../../../../../packages/editor-ui/src/events/Events")),
  ...(await import("../../../../../../../../packages/editor-ui/src/ui/Button")),
  ...(await import("../../../../../../../../packages/editor-ui/src/ui/LoadingState")),
}));

const event: ProjectEventRecord = {
  id: "event",
  projectId: "project",
  source: "replay",
  ingressEventId: null,
  pluginId: "test",
  eventType: "test-event",
  providerEventId: null,
  eventPayload: { message: "hello" },
  traceId: null,
  traceContext: null,
  receivedAt: "2026-08-28T12:00:00.000Z",
};
const ingress: ProjectIngressEventRecord = {
  id: "ingress",
  projectId: "project",
  endpointId: "endpoint",
  pluginId: "test",
  eventType: "test-ingress",
  eventId: null,
  eventPayload: { message: "hello" },
  traceId: null,
  traceContext: null,
  previewOnly: false,
  previewGeneration: null,
  receivedAt: event.receivedAt,
};
const replayResult = {
  projectEventId: "new-event",
  executionId: "new-execution",
  deploymentId: "current-deployment",
};

let dispose = () => {};
let queryClient: QueryClient;
afterEach(() => {
  dispose();
  queryClient.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const setup = async (
  options: {
    selected?: "event" | "ingress";
    canEdit?: boolean;
    canViewTraces?: boolean;
    event?: ProjectEventRecord;
    events?: ReadonlyArray<ProjectEventRecord>;
    executions?: ReadonlyArray<ProjectExecutionRecord>;
    ingress?: ProjectIngressEventRecord;
    currentDeploymentId?: string | null;
  } = {},
) => {
  const api: EventsApiClient = {
    list: () => Effect.never,
    replay: () => Effect.never,
  };
  vi.spyOn(api, "list").mockReturnValue(
    Effect.succeed({
      events: options.events ?? [options.event ?? event],
      ingressEvents: [options.ingress ?? ingress],
      ingresses: [],
      executions: options.executions ?? [],
    }),
  );
  vi.spyOn(api, "replay").mockReturnValue(Effect.succeed(replayResult));
  const credentialsApi: CredentialsApiClient = {
    list: () => Effect.die("Credentials are not needed for this test"),
    refetch: () => Effect.die("Credentials are not needed for this test"),
  };
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const onSelectionChange = vi.fn();
  let select!: (id: string) => void;
  queryClient = new QueryClient();
  dispose = render(() => {
    const [selection, setSelection] = createSignal<string>(options.selected ?? "event");
    select = setSelection;
    return (
      <QueryClientProvider client={queryClient}>
        <Events
          projectId="project"
          selectedEventId={selection()}
          canViewTraces={options.canViewTraces ?? false}
          canEdit={options.canEdit ?? true}
          currentDeploymentId={
            options.currentDeploymentId === undefined
              ? "current-deployment"
              : options.currentDeploymentId
          }
          api={api}
          credentialsApi={credentialsApi}
          onSelectionChange={onSelectionChange}
        />
      </QueryClientProvider>
    );
  }, document.body);
  await vi.waitFor(() => {
    flush();
    expect(document.querySelector("h2")?.textContent).toBe(
      options.selected === "ingress" ? "test-ingress" : "test-event",
    );
  });
  const button = () =>
    document.querySelector("h2")?.closest("header")?.querySelector("button") ?? null;
  return { api: vi.mocked(api), confirm, button, select, onSelectionChange };
};

it("links a replay to its own trace and time window rather than the original ingress", async () => {
  vi.stubEnv("VITE_AXIOM_ORG_ID", "test-org");
  vi.stubEnv("VITE_AXIOM_TRACE_DATASET", "macrograph-traces");
  const { select } = await setup({
    canViewTraces: true,
    event: { ...event, ingressEventId: ingress.id, traceId: "replay-trace" },
    ingress: { ...ingress, traceId: "original-trace", receivedAt: "2026-08-27T12:00:00.000Z" },
  });
  const traceLink = () => document.querySelector<HTMLAnchorElement>('a[target="_blank"]');
  const replayUrl = new URL(traceLink()!.href);
  expect(replayUrl.pathname).toBe("/test-org/trace");
  expect(replayUrl.searchParams.get("traceId")).toBe("replay-trace");
  expect(replayUrl.searchParams.get("startTime")).toBe("2026-08-28T11:55:00.000Z");
  expect(replayUrl.searchParams.get("endTime")).toBe("2026-08-28T12:05:00.000Z");
  expect(replayUrl.searchParams.get("traceDataset")).toBe("macrograph-traces");

  select("ingress");
  flush();
  const ingressUrl = new URL(traceLink()!.href);
  expect(ingressUrl.searchParams.get("traceId")).toBe("original-trace");
  expect(ingressUrl.searchParams.get("startTime")).toBe("2026-08-27T11:55:00.000Z");
});

it("keeps original and replay events separate but links their shared trace through later replays", async () => {
  vi.stubEnv("VITE_AXIOM_ORG_ID", "test-org");
  const traceContext = {
    traceId: "shared-trace",
    spanId: "original-span",
    sampled: true,
    startedAt: "2026-08-27T12:00:00.000Z",
  };
  const originalIngress = {
    ...ingress,
    traceId: traceContext.traceId,
    traceContext,
    receivedAt: traceContext.startedAt,
  };
  const originalEvent: ProjectEventRecord = {
    ...event,
    id: "original-event",
    source: "ingress",
    ingressEventId: ingress.id,
    traceId: traceContext.traceId,
    traceContext,
    receivedAt: traceContext.startedAt,
  };
  const replayEvent = {
    ...event,
    ingressEventId: ingress.id,
    traceId: traceContext.traceId,
    traceContext,
  };
  const { select } = await setup({
    canViewTraces: true,
    events: [originalEvent, replayEvent],
    ingress: originalIngress,
  });
  const traceLink = () => document.querySelector<HTMLAnchorElement>('a[target="_blank"]');
  const replayUrl = new URL(traceLink()!.href);
  expect(replayUrl.searchParams.get("traceId")).toBe("shared-trace");
  expect(replayUrl.searchParams.get("startTime")).toBe("2026-08-27T11:55:00.000Z");
  expect(replayUrl.searchParams.get("endTime")).toBe("2026-08-28T12:05:00.000Z");

  select("original-event");
  flush();
  expect(document.querySelector("h2")?.closest("header")?.textContent).toContain("original-event");
  expect(traceLink()!.href).toBe(replayUrl.href);
  select("ingress");
  flush();
  expect(traceLink()!.href).toBe(replayUrl.href);

  queryClient.setQueryData(["events", "project"], {
    events: [
      originalEvent,
      replayEvent,
      { ...replayEvent, id: "later-replay", receivedAt: "2026-08-29T12:00:00.000Z" },
      { ...event, id: "unrelated", traceId: "other-trace", receivedAt: "2026-08-30T12:00:00.000Z" },
    ],
    ingressEvents: [originalIngress],
    ingresses: [],
    executions: [],
  });
  await vi.waitFor(() => {
    flush();
    expect(new URL(traceLink()!.href).searchParams.get("endTime")).toBe("2026-08-29T12:05:00.000Z");
  });
  const updatedUrl = traceLink()!.href;
  select("original-event");
  flush();
  expect(traceLink()!.href).toBe(updatedUrl);
  select("event");
  flush();
  expect(traceLink()!.href).toBe(updatedUrl);
});

it("uses the persisted trace start when the original event is outside the query window", async () => {
  vi.stubEnv("VITE_AXIOM_ORG_ID", "test-org");
  await setup({
    canViewTraces: true,
    event: {
      ...event,
      traceId: "shared-trace",
      traceContext: {
        traceId: "shared-trace",
        spanId: "original-span",
        sampled: true,
        startedAt: "2026-08-20T12:00:00.000Z",
      },
    },
  });
  const url = new URL(document.querySelector<HTMLAnchorElement>('a[target="_blank"]')!.href);
  expect(url.searchParams.get("traceId")).toBe("shared-trace");
  expect(url.searchParams.get("startTime")).toBe("2026-08-20T11:55:00.000Z");
  expect(url.searchParams.get("endTime")).toBe("2026-08-28T12:05:00.000Z");
});

it.each(["complete", "queued", "running"] as const)(
  "extends the original ingress trace window through a related %s execution",
  async (status) => {
    vi.stubEnv("VITE_AXIOM_ORG_ID", "test-org");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-28T14:00:00.000Z"));
    await setup({
      selected: "ingress",
      canViewTraces: true,
      ingress: { ...ingress, traceId: "shared-trace" },
      event: { ...event, traceId: "shared-trace", ingressEventId: ingress.id },
      executions: [
        {
          id: "execution",
          projectId: event.projectId,
          projectEventId: event.id,
          deploymentId: "deployment",
          status,
          receivedAt: event.receivedAt,
          startedAt: status === "queued" ? null : "2026-08-28T12:01:00.000Z",
          completedAt: status === "complete" ? "2026-08-28T13:00:00.000Z" : null,
          error: null,
        },
      ],
    });
    const url = new URL(document.querySelector<HTMLAnchorElement>('a[target="_blank"]')!.href);
    expect(url.searchParams.get("endTime")).toBe(
      status === "complete" ? "2026-08-28T13:05:00.000Z" : "2026-08-28T14:05:00.000Z",
    );
  },
);

it.each(["replay", "ingress"] as const)(
  "only falls back to the original ingress trace for historical non-replay events: %s",
  async (source) => {
    vi.stubEnv("VITE_AXIOM_ORG_ID", "test-org");
    await setup({
      canViewTraces: true,
      event: { ...event, source, ingressEventId: ingress.id },
      ingress: { ...ingress, traceId: "original-trace" },
    });
    const link = document.querySelector<HTMLAnchorElement>('a[target="_blank"]');
    if (source === "replay") expect(link).toBeNull();
    else expect(new URL(link!.href).searchParams.get("traceId")).toBe("original-trace");
  },
);

it.each(["event", "ingress"] as const)(
  "replays %s once and keeps the original selection",
  async (kind) => {
    const { api, confirm, button, select, onSelectionChange } = await setup({ selected: kind });
    const pending = Promise.withResolvers<typeof replayResult>();
    api.replay.mockReturnValue(Effect.promise(() => pending.promise));
    button()?.click();
    button()?.click();
    flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain("all matching graphs");
    expect(confirm.mock.calls[0]?.[0]).toContain("not unpublished edits");
    expect(confirm.mock.calls[0]?.[0]).toContain("real actions");
    expect(button()?.disabled).toBe(true);
    expect(button()?.textContent).toBe("Replaying...");
    await vi.waitFor(() => expect(api.replay).toHaveBeenCalledTimes(1));
    expect(api.replay).toHaveBeenCalledWith({
      params: { projectId: "project", eventId: kind },
      payload: { kind },
    });
    select(kind === "event" ? "ingress" : "event");
    pending.resolve(replayResult);
    await vi.waitFor(() => {
      flush();
      expect(button()?.disabled).toBe(false);
    });
    expect(document.body.textContent).not.toContain("Replay queued");
    select(kind);
    flush();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Replay queued on deployment current-deployment",
    );
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(document.querySelector("h2")?.textContent).toBe(`test-${kind}`);
  },
);

it("does not replay when confirmation is cancelled", async () => {
  const { api, confirm, button } = await setup();
  confirm.mockReturnValue(false);
  button()?.click();
  expect(api.replay).not.toHaveBeenCalled();
});

it("requires a current deployment", async () => {
  const { api, button } = await setup({ currentDeploymentId: null });
  expect(button()?.disabled).toBe(true);
  expect(document.body.textContent).toContain("Deploy this project to replay events.");
  button()?.click();
  expect(api.replay).not.toHaveBeenCalled();
});

it("hides replay for viewers", async () => {
  const { api, button } = await setup({ canEdit: false });
  expect(button()).toBeNull();
  expect(api.replay).not.toHaveBeenCalled();
});

it.each([
  [new EventNotFound(), "This event is no longer available"],
  [new DeploymentNotFound(), "There is no current deployment"],
  [new ProjectNotFound(), "you do not have permission"],
  [new HttpApiError.Unauthorized(), "Your session has expired"],
] as const)("shows useful feedback for %s", async (error, message) => {
  const { api, button } = await setup();
  api.replay.mockReturnValue(Effect.fail(error));
  button()?.click();
  await vi.waitFor(() => {
    flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(button()?.disabled).toBe(false);
  });
});

it("warns against duplicate actions when the replay outcome is unknown", async () => {
  const { api, button } = await setup();
  api.replay.mockReturnValue(Effect.die("network failure"));
  button()?.click();
  await vi.waitFor(() => {
    flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Check the timeline before trying again",
    );
  });
});
