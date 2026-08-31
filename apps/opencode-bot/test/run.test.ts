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
  vi.restoreAllMocks();
});

it("keeps confidential model identity out of arguments and logs", async () => {
  const model = "private-provider/private-model";
  vi.stubEnv("OPENCODE_MODEL", model);
  vi.stubEnv("OPENCODE_TOKEN_EXPIRES", String(Date.now() + 600_000));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await import("../src/run.ts");
  expect(spawnSync).toHaveBeenCalledWith(
    "opencode2",
    expect.not.arrayContaining([model]),
    expect.objectContaining({
      stdio: "ignore",
      env: expect.objectContaining({ OPENCODE_CONFIG_CONTENT: expect.stringContaining(model) }),
    }),
  );
  expect(JSON.stringify(log.mock.calls)).not.toContain(model);
});
