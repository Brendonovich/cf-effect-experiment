import { expect, it, vi } from "vitest";

import { processWorkflowRun, repository } from "../src/workflow-run.ts";

const config = {
  botUserId: "123456789",
  discordWebhook: "https://discord.com/api/webhooks/123/token",
  github: {
    getPull: async () => ({
      state: "open",
      draft: false,
      html_url: `https://github.com/${repository}/pull/42`,
      user: { login: "maintainer" },
      head: { sha: "abc123", repo: { full_name: repository } },
    }),
    getCollaboratorPermission: async () => ({ permission: "write" }),
  },
};

const payload = {
  action: "completed",
  repository: { full_name: repository },
  workflow_run: {
    name: "CI",
    conclusion: "failure",
    event: "pull_request",
    actor: { type: "User" },
    head_sha: "abc123",
    html_url: `https://github.com/${repository}/actions/runs/7`,
    pull_requests: [{ number: 42 }],
  },
};

it("notifies Discord for a current maintainer PR failure", async () => {
  const request = vi.fn(async (_input: string | URL | Request) =>
    new Response(null, { status: 204 }));

  expect(await processWorkflowRun(payload, config, request)).toBe("notified");
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0]).toBe(config.discordWebhook);
});

it("rejects failures that should not invoke the bot before making requests", async () => {
  const request = vi.fn<typeof fetch>();
  expect(
    await processWorkflowRun(
      { ...payload, workflow_run: { ...payload.workflow_run, conclusion: "success" } },
      config,
      request,
    ),
  ).toBe("not-failed");
  expect(
    await processWorkflowRun(
      { ...payload, workflow_run: { ...payload.workflow_run, actor: { type: "Bot" } } },
      config,
      request,
    ),
  ).toBe("bot-triggered");
  expect(request).not.toHaveBeenCalled();
});

it("rejects stale and non-maintainer PRs", async () => {
  const pull = {
    state: "open",
    draft: false,
    html_url: `https://github.com/${repository}/pull/42`,
    user: { login: "contributor" },
    head: { sha: "newer", repo: { full_name: repository } },
  };
  const stale = { ...config, github: { ...config.github, getPull: async () => pull } };
  expect(await processWorkflowRun(payload, stale)).toBe("stale-run");

  const nonMaintainer = {
    ...config,
    github: {
      getPull: async () => ({ ...pull, head: { ...pull.head, sha: "abc123" } }),
      getCollaboratorPermission: async () => ({ permission: "read" }),
    },
  };
  expect(await processWorkflowRun(payload, nonMaintainer)).toBe("not-maintainer");
});

it("does not notify for draft pull requests", async () => {
  const request = vi.fn<typeof fetch>();
  const draft = {
    ...config,
    github: {
      ...config.github,
      getPull: async () => ({ ...(await config.github.getPull()), draft: true }),
    },
  };
  expect(await processWorkflowRun(payload, draft, request)).toBe("draft");
  expect(request).not.toHaveBeenCalled();
});
