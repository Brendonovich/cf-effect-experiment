import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/module";
import { Effect } from "effect";

import deployment from "../src/Deployment.ts";
import module from "../src/Module.ts";

describe("GitHub module", () => {
  it.effect("registers the curated REST and webhook catalog", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(module.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        [
          "GetRepository",
          "ListBranches",
          "ListReleases",
          "ListContributors",
          "ListCommits",
          "ListIssues",
          "ListPullRequests",
          "GetIssue",
          "GetPullRequest",
          "CreateIssue",
          "UpdateIssue",
          "CreateComment",
          "webhook:push",
          "webhook:pull-request",
          "webhook:issues",
          "webhook:issue-comment",
          "webhook:workflow-run",
          "webhook:release",
        ],
      );
      assert.strictEqual(deployment.moduleId, "github");
      assert.strictEqual(deployment.definition, module.engine);
    }),
  );
});
