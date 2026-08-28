import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import { eventKinds } from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";
import { decodeEvent } from "../src/Events.ts";
import plugin, { catalog } from "../src/Plugin.ts";
import { samples } from "./Fixtures.ts";

describe("TikTok catalog", () => {
  it.effect("registers 19 unique event schemas with working typed output mappings", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.strictEqual(schemas.length, 19);
      assert.strictEqual(new Set(schemas.map((schema) => schema.id)).size, 19);
      assert.deepStrictEqual(
        catalog.map(([kind]) => kind),
        [...eventKinds],
      );
      const events = samples.map(([kind, payload]) => decodeEvent(kind, payload)!);
      for (let index = 0; index < schemas.length; index++) {
        const schema = schemas[index]!;
        const event = events[index]!;
        assert.strictEqual(schema.type, "event");
        assert.strictEqual(schema.id, `TikTok${catalog[index]![1]}`);
        for (let other = 0; other < events.length; other++)
          assert.strictEqual(yield* schema.matches(events[other]!, {}), index === other);
        const output: Record<string, unknown> = {};
        yield* schema.run({
          input: () => undefined,
          output: (ref, value) => {
            output[ref.id] = value;
          },
          properties: {},
          event,
          engine: {},
          execution: {
            projectId: "project",
            graphId: "graph",
            eventNodeId: "node",
            traceId: "trace",
          },
          node: {
            nodeId: "node",
            kind: "event",
            executionPath: "0",
            traceId: "trace",
            withSpan: (_, effect) => effect,
          },
        });
        const [, , , strings, numbers, booleans] = catalog[index]!;
        for (const field of [
          "user",
          "userId",
          "nickname",
          "payloadJson",
          ...strings,
          ...numbers,
          ...booleans,
        ] as const)
          assert.strictEqual(output[field], event[field]);
        assert.strictEqual(schema.dataOutputs.length, Object.keys(output).length);
        assert.strictEqual(schema.executionOutputs.length, 1);
      }
      assert.strictEqual(plugin.id, "tiktok-euler-stream");
      assert.strictEqual(plugin.name, "TikTok (Euler Stream)");
      assert.strictEqual(deployment.pluginId, "tiktok-euler-stream");
      assert.strictEqual(deployment.definition, plugin.engine);
    }),
  );
});
