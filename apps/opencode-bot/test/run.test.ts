import { afterEach, expect, it, vi } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0 })));
vi.mock("node:child_process", () => ({ spawnSync }));
vi.mock("node:fs", () => ({
  readFileSync: () =>
    JSON.stringify({
      issue: { html_url: "https://github.com/example/repo/issues/1" },
      comment: {
        html_url: "https://github.com/example/repo/issues/1#comment",
        body: "/oc Explain this",
      },
    }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("selects the confidential model explicitly without logging its identity", async () => {
  const model = "private-provider/private-model";
  vi.stubEnv("OPENCODE_MODEL", model);
  vi.stubEnv("OPENCODE_TOKEN_EXPIRES", String(Date.now() + 600_000));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    config: { provider: { "private-provider": { models: { "private-model": {} } } } },
  })));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await import("../src/run.ts");
  expect(spawnSync).toHaveBeenCalledWith(
    "opencode2",
    expect.arrayContaining(["--model", model]),
    expect.objectContaining({
      stdio: ["ignore", "pipe", "pipe"],
      env: expect.objectContaining({ OPENCODE_CONFIG_CONTENT: expect.stringContaining(model) }),
    }),
  );
  expect(JSON.stringify(log.mock.calls)).not.toContain(model);
});
