import { assert, describe, it } from "@effect/vitest";

import { Channel } from "../src/Channel.ts";
import { clientSetups } from "../src/Cli.ts";
import { ServicePaths } from "../src/ServicePaths.ts";

const env = { XDG_STATE_HOME: "/state", XDG_CONFIG_HOME: "/config", XDG_DATA_HOME: "/data" };

describe("release channels", () => {
  it("defaults to local when unbuilt and honours MACROGRAPH_CHANNEL", () => {
    assert.strictEqual(Channel.build, "local");
    assert.strictEqual(Channel.current({}), "local");
    assert.strictEqual(Channel.current({ MACROGRAPH_CHANNEL: " " }), "local");
    assert.strictEqual(Channel.current({ MACROGRAPH_CHANNEL: "latest" }), "latest");
  });

  it("gives latest the unsuffixed files and port 3170", () => {
    assert.deepStrictEqual(ServicePaths.make("latest", env), {
      channel: "latest",
      registration: "/state/macrograph/service.json",
      config: "/config/macrograph/service.json",
      data: "/data/macrograph",
    });
    assert.strictEqual(Channel.defaultPort("latest"), 3170);
  });

  it("gives local its own files and port 3171", () => {
    assert.deepStrictEqual(ServicePaths.make("local", env), {
      channel: "local",
      registration: "/state/macrograph/service-local.json",
      config: "/config/macrograph/service-local.json",
      data: "/data/macrograph-local",
    });
    assert.strictEqual(Channel.defaultPort("local"), 3171);
  });

  it("sanitizes other channels and derives a stable port for them", () => {
    const paths = ServicePaths.make("feat/x y", env);
    assert.strictEqual(paths.registration, "/state/macrograph/service-feat-x-y.json");
    assert.strictEqual(paths.config, "/config/macrograph/service-feat-x-y.json");
    assert.strictEqual(paths.data, "/data/macrograph-feat-x-y");
    for (const channel of ["beta", "feat/x y", "../../etc"]) {
      const port = Channel.defaultPort(channel);
      assert.strictEqual(port, Channel.defaultPort(channel));
      assert.isAtLeast(port, 20_000);
      assert.isBelow(port, 30_000);
    }
    assert.notStrictEqual(Channel.defaultPort("beta"), Channel.defaultPort("next"));
    assert.notInclude(ServicePaths.make("../../etc", env).registration, "../");
  });

  it("never shares a file between channels", () => {
    const files = ["latest", "local", "beta", "feat"].map((channel) =>
      ServicePaths.make(channel, env),
    );
    for (const key of ["registration", "config", "data"] as const)
      assert.strictEqual(new Set(files.map((paths) => paths[key])).size, files.length);
  });

  it("configures MCP clients for a channel", () => {
    assert.deepStrictEqual(clientSetups("latest"), [
      {
        id: "opencode",
        name: "OpenCode",
        command: "opencode mcp add macrograph -- macrograph mcp",
        note: "Add --global to connect it in every project.",
      },
      {
        id: "claude-code",
        name: "Claude Code",
        command: "claude mcp add macrograph -- macrograph mcp",
      },
      {
        id: "codex",
        name: "Codex",
        command: "codex mcp add macrograph -- macrograph mcp",
      },
      {
        id: "cursor",
        name: "Cursor and other clients",
        json: { mcpServers: { macrograph: { command: "macrograph", args: ["mcp"] } } },
        note: "Merge this into the client's MCP configuration file.",
      },
    ]);
    assert.deepStrictEqual(clientSetups("local"), [
      {
        id: "opencode",
        name: "OpenCode",
        command:
          "opencode mcp add macrograph-local --env MACROGRAPH_CHANNEL=local -- macrograph mcp",
        note: "Add --global to connect it in every project.",
      },
      {
        id: "claude-code",
        name: "Claude Code",
        command: "claude mcp add macrograph-local -e MACROGRAPH_CHANNEL=local -- macrograph mcp",
      },
      {
        id: "codex",
        name: "Codex",
        command: "codex mcp add macrograph-local --env MACROGRAPH_CHANNEL=local -- macrograph mcp",
      },
      {
        id: "cursor",
        name: "Cursor and other clients",
        json: {
          mcpServers: {
            "macrograph-local": {
              command: "macrograph",
              args: ["mcp"],
              env: { MACROGRAPH_CHANNEL: "local" },
            },
          },
        },
        note: "Merge this into the client's MCP configuration file.",
      },
    ]);
  });
});
