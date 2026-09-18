import { expect, it, vi } from "vitest";

import { discordWebhookUrl, notificationContent, notifyDiscord } from "../src/notify-discord.ts";

const notification = {
  botUserId: "123456789",
  repository: "example/repo",
  pullRequestUrl: "https://github.com/example/repo/pull/42",
  workflowRunUrl: "https://github.com/example/repo/actions/runs/7",
};

it("accepts only canonical Discord webhook URLs", () => {
  expect(discordWebhookUrl("https://discord.com/api/webhooks/123/token_value")).toBe(
    "https://discord.com/api/webhooks/123/token_value",
  );
  for (const url of [
    "https://example.com/api/webhooks/123/token",
    "http://discord.com/api/webhooks/123/token",
    "https://discord.com/api/webhooks/123/token?wait=true",
    "https://discord.com/api/webhooks/123/token/extra",
  ]) {
    expect(() => discordWebhookUrl(url)).toThrow();
  }
});

it("mentions the configured bot with the PR and failed run", () => {
  expect(notificationContent(notification)).toContain("<@123456789>");
  expect(notificationContent(notification)).toContain(notification.pullRequestUrl);
  expect(notificationContent(notification)).toContain(notification.workflowRunUrl);
});

it("posts with an explicit mention allowlist and suppressed link embeds", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
  await notifyDiscord("https://discord.com/api/webhooks/123/token", notification, fetch);
  expect(fetch).toHaveBeenCalledWith(
    "https://discord.com/api/webhooks/123/token",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"users":["123456789"]'),
    }),
  );
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ flags: 4 });
});
