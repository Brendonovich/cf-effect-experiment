import { assert, describe, it } from "@effect/vitest";
import { CreateProjectRequest } from "@macrograph/cloud-api";
import { Effect, Result, Schema } from "effect";

import { revisionObjectKey } from "../src/AppStorage.ts";

describe("AppStorage", () => {
  it.effect("builds immutable revision object keys", () =>
    Effect.sync(() => {
      assert.strictEqual(
        revisionObjectKey("project-1", "revision-2"),
        "projects/project-1/revisions/revision-2.json",
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
});
