// @vitest-environment jsdom
import {
  DeploymentNotFound,
  EventNotFound,
  ProjectNotFound,
  type ProjectEventRecord,
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
});

const setup = async (
  options: {
    selected?: "event" | "ingress";
    canEdit?: boolean;
    currentDeploymentId?: string | null;
  } = {},
) => {
  const api: EventsApiClient = {
    list: () => Effect.never,
    replay: () => Effect.never,
  };
  vi.spyOn(api, "list").mockReturnValue(
    Effect.succeed({ events: [event], ingressEvents: [ingress], ingresses: [], executions: [] }),
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
          canViewTraces={false}
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
