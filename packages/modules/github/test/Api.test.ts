import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { makeApi, prepare } from "../src/Api.ts";
import { AccountId, GitHubFailure, InstallationId } from "../src/Definition.ts";

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

  it.effect("discovers GitHub App installations and their repositories", () =>
    Effect.gen(function* () {
      const requests: Array<{ readonly url: string; readonly authorization?: string }> = [];
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push({
            url: request.url,
            ...(request.headers.authorization === undefined
              ? {}
              : { authorization: request.headers.authorization }),
          });
          const body = request.url.includes("/repositories")
            ? {
                repositories: [
                  {
                    id: 20,
                    name: "macrograph",
                    full_name: "macrograph/macrograph",
                    owner: { login: "macrograph" },
                  },
                ],
              }
            : {
                installations: [
                  { id: 10, account: { id: 1, login: "macrograph", type: "Organization" } },
                ],
              };
          return HttpClientResponse.fromWeb(
            request,
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }),
      );
      const accountId = AccountId.make("user-1");
      const api = yield* makeApi(() =>
        Effect.succeed({ token: Redacted.make("github-user-token") }),
      ).pipe(Effect.provideService(HttpClient.HttpClient, client));

      assert.deepStrictEqual(yield* api.listInstallations(accountId), [
        {
          id: InstallationId.make("10"),
          accountId: "1",
          accountLogin: "macrograph",
          accountType: "Organization",
        },
      ]);
      assert.deepStrictEqual(yield* api.listRepositories(accountId, InstallationId.make("10")), [
        {
          id: "20",
          name: "macrograph",
          fullName: "macrograph/macrograph",
          owner: "macrograph",
        },
      ]);
      assert.deepStrictEqual(
        requests.map((request) => request.authorization),
        ["Bearer github-user-token", "Bearer github-user-token"],
      );
    }).pipe(Effect.scoped),
  );
});
