// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { Effect } from "effect";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

import {
  LiveEvents,
  type LiveEventsProps,
} from "../../../../../../../../packages/editor-ui/src/events/LiveEvents";

const event: LiveEventsProps["events"][number] = {
  id: "original-event",
  pluginId: "test",
  name: "Message",
  source: "Engine",
  replayable: true,
  startedAt: Date.now(),
  finishedAt: Date.now(),
  status: "complete",
  payload: '{"_tag":"Message","message":"hello"}',
  error: null,
  nodes: [],
};

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const replayButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    /^Replay(?:ing\.\.\.)?$/.test(button.textContent ?? ""),
  );
const select = (id: string) => {
  [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")]
    .find((button) => button.textContent?.includes(id))!
    .click();
  flush();
};
const setup = (options: Partial<LiveEventsProps> = {}) => {
  const onReplay = vi.fn((_id: string): Effect.Effect<void, unknown> => Effect.void);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  let updateEvents!: (events: LiveEventsProps["events"]) => void;
  dispose = render(() => {
    const [events, setEvents] = createSignal<LiveEventsProps["events"]>(options.events ?? [event]);
    updateEvents = setEvents;
    return (
      <LiveEvents
        state="live"
        error=""
        onRetry={() => {}}
        onReplay={onReplay}
        {...options}
        events={events()}
      />
    );
  }, document.body);
  flush();
  select(event.id);
  return { onReplay, confirm, updateEvents };
};

it("queues replay once, warns about side effects, and keeps feedback on the original event", async () => {
  const { onReplay, confirm, updateEvents } = setup();
  const pending = Promise.withResolvers<void>();
  onReplay.mockReturnValue(Effect.promise(() => pending.promise));
  replayButton()!.click();
  replayButton()!.click();
  flush();
  expect(replayButton()!.disabled).toBe(true);
  expect(replayButton()!.textContent).toBe("Replaying...");
  await vi.waitFor(() => expect(onReplay).toHaveBeenCalledExactlyOnceWith(event.id));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0]?.[0]).toContain("runtime's current project");
  expect(confirm.mock.calls[0]?.[0]).toContain("may repeat side effects");

  updateEvents([{ ...event, id: "new-event", source: "Replay" }, event]);
  flush();
  expect(document.querySelector('button[aria-pressed="true"]')?.textContent).toContain(event.id);
  select("new-event");
  pending.resolve();
  await vi.waitFor(() => expect(replayButton()!.disabled).toBe(false));
  expect(document.body.textContent).not.toContain("Replay queued.");
  select(event.id);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Replay queued.");
});

it("does not replay when confirmation is cancelled", () => {
  const { onReplay, confirm } = setup();
  confirm.mockReturnValue(false);
  replayButton()!.click();
  flush();
  expect(onReplay).not.toHaveBeenCalled();
  expect(replayButton()!.disabled).toBe(false);
});

it("hides replay when the connection does not allow it", () => {
  const { onReplay } = setup({ onReplay: undefined });
  expect(replayButton()).toBeUndefined();
  expect(onReplay).not.toHaveBeenCalled();
});

it.each([{ state: "error" as const }, { events: [{ ...event, replayable: false }] }])(
  "disables replay when unavailable: %o",
  (options) => {
    const { onReplay, confirm } = setup(options);
    expect(replayButton()!.disabled).toBe(true);
    replayButton()!.click();
    expect(confirm).not.toHaveBeenCalled();
    expect(onReplay).not.toHaveBeenCalled();
  },
);

it.each([
  [Effect.fail({ _tag: "ReplayUnavailable", eventId: event.id }), "no longer available"],
  [Effect.fail({ _tag: "EditorForbidden" }), "do not have permission"],
  [
    Effect.die("network failure"),
    "Check the timeline before trying again to avoid duplicate actions",
  ],
] as const)(
  "reports replay failures without suggesting unsafe retries",
  async (failure, message) => {
    const { onReplay } = setup();
    onReplay.mockReturnValue(failure);
    replayButton()!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(message),
    );
    expect(replayButton()!.disabled).toBe(false);
  },
);
