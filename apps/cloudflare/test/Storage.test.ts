import { assert, describe, it } from "@effect/vitest";
import { CreateGraphRequest, CreateProjectRequest } from "@macrograph/cloud-api";
import { Effect, Result, Schema } from "effect";

import { deploymentObjectKey } from "../src/deployment/DeploymentObjectKey.ts";

describe("Storage", () => {
  it.effect("builds immutable deployment object keys", () =>
    Effect.sync(() => {
      assert.strictEqual(
        deploymentObjectKey("project-1", "deployment-2"),
        "projects/project-1/revisions/deployment-2.json",
      );
    }),
  );

  it.effect("validates project names", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(CreateProjectRequest);
      assert.deepStrictEqual(yield* decode({ name: "Stream tools" }), { name: "Stream tools" });
      assert.deepStrictEqual(
        yield* decode({
          name: "Private tools",
          teamId: "team-1",
          access: "restricted",
          userIds: ["user-1"],
        }),
        {
          name: "Private tools",
          teamId: "team-1",
          access: "restricted",
          userIds: ["user-1"],
        },
      );
      assert.isTrue(Result.isFailure(yield* Effect.result(decode({ name: "" }))));
      assert.isTrue(Result.isFailure(yield* Effect.result(decode({ name: "x".repeat(121) }))));
    }),
  );

  it.effect("accepts graph nodes and connections with temporary node references", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(CreateGraphRequest);
      const input = {
        name: "Example Workflow",
        nodes: {
          timer: { schema: { package: "util", schema: "Tick" } },
          print: {
            schema: { package: "util", schema: "Print" },
            position: { x: 320, y: 0 },
          },
        },
        connections: [
          { outNodeId: "timer", outIoId: "exec", inNodeId: "print", inIoId: "exec" },
        ],
      };

      assert.deepStrictEqual(yield* decode({}), {});
      assert.deepStrictEqual(yield* decode(input), input);
      assert.isTrue(
        Result.isFailure(yield* Effect.result(decode({ nodes: { timer: { schema: "Tick" } } }))),
      );
    }),
  );
});
