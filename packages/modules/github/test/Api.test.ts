import { assert, describe, it } from "@effect/vitest";

import { prepare } from "../src/Api.ts";
import { GitHubFailure } from "../src/Definition.ts";

describe("GitHub REST actions", () => {
  it("builds only fixed GitHub API paths", () => {
    assert.deepStrictEqual(
      prepare("get-issue", { owner: "macrograph", repository: "macrograph", number: 42 }),
      { method: "GET", path: "/repos/macrograph/macrograph/issues/42" },
    );
    assert.deepStrictEqual(
      prepare("list-commits", {
        owner: "space owner",
        repository: "repo/name",
        ref: "feature/test",
        perPage: 500,
      }),
      {
        method: "GET",
        path: "/repos/space%20owner/repo%2Fname/commits",
        query: { per_page: 100, sha: "feature/test" },
      },
    );
  });

  it("rejects missing and invalid inputs before HTTP", () => {
    const failure = (run: () => unknown) => {
      try {
        run();
        assert.fail("Expected GitHubFailure");
      } catch (error) {
        assert.instanceOf(error, GitHubFailure);
        return error as GitHubFailure;
      }
    };
    assert.include(
      failure(() => prepare("get-repository", { owner: "macrograph" })).reason,
      "repository",
    );
    assert.include(
      failure(() =>
        prepare("get-issue", { owner: "macrograph", repository: "macrograph", number: 0 }),
      ).reason,
      "positive integer",
    );
  });
});
