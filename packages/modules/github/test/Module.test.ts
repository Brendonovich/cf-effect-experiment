import { assert, describe, it } from "@effect/vitest";
import { Registration, t } from "@macrograph/module";
import { Effect, Option, Schema } from "effect";

import { WebhookDelivery, WebhookId } from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";
import module from "../src/Module.ts";
import { WebhookPayloadTypes, WebhookTypeDefinitions } from "../src/WebhookTypes.ts";

describe("GitHub module", () => {
  it("registers every type referenced by its webhook payloads", () => {
    const visit = (type: t.Type): void => {
      if (type._tag === "Struct" || type._tag === "Enum")
        assert.property(WebhookTypeDefinitions, type.id);
      else if (type._tag === "List") visit(type.item);
      else if (type._tag === "Option") visit(type.inner);
    };
    for (const type of Object.values(WebhookPayloadTypes)) visit(type);
    for (const definition of Object.values(WebhookTypeDefinitions))
      for (const field of definition._tag === "Struct"
        ? definition.fields
        : definition.variants.flatMap((variant) => variant.fields))
        visit(field.type);
  });

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

  it.effect("decodes webhook payloads as concrete module types", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(module.effect);
      const webhook = schemas.find((schema) => schema.id === "webhook:release");
      assert.isDefined(webhook);
      assert.deepStrictEqual(
        webhook.dataOutputs.find((output) => output.id === "payload")?.type,
        WebhookPayloadTypes.release,
      );
      const outputs = new Map<string, unknown>();
      yield* webhook.run({
        types: {
          resolve: (type) => type,
          definitions: WebhookTypeDefinitions,
        },
        input: () => undefined,
        output: (ref, value) => outputs.set(ref.id, value),
        properties: { webhook: WebhookId.make("primary") },
        event: new WebhookDelivery({
          webhookId: WebhookId.make("primary"),
          event: "release",
          action: "published",
          owner: "macrograph",
          repository: "macrograph",
          sender: "octocat",
          deliveryId: "delivery-1",
          payload: {
            action: "published",
            release: {
              id: 30,
              tag_name: "v1.0.0",
              target_commitish: "main",
              name: null,
              body: "Release notes",
              draft: false,
              prerelease: false,
              html_url: "https://github.com/macrograph/macrograph/releases/tag/v1.0.0",
              author: {
                login: "octocat",
                id: 1,
                type: "User",
                html_url: "https://github.com/octocat",
              },
            },
            repository: {
              id: 20,
              name: "macrograph",
              full_name: "macrograph/macrograph",
              private: false,
              html_url: "https://github.com/macrograph/macrograph",
              default_branch: "main",
              extra: "ignored",
            },
            sender: {
              login: "octocat",
              id: 1,
              type: "User",
              html_url: "https://github.com/octocat",
            },
            installation: { id: 10 },
          },
        }),
        engine: undefined,
        execution: {
          projectId: "project",
          graphId: "graph",
          eventNodeId: "event",
          traceId: "execution",
        },
        node: {
          nodeId: "node",
          kind: "event",
          executionPath: "event:event",
          traceId: "node",
          withSpan: (_name, effect) => effect,
        },
      });
      const payload = Schema.decodeUnknownSync(
        Schema.Struct({
          _type: Schema.String,
          action: Schema.Struct({ _type: Schema.String, _tag: Schema.String }),
          release: Schema.Struct({
            _type: Schema.String,
            tag_name: Schema.String,
            name: Schema.Option(Schema.String),
            body: Schema.Option(Schema.String),
          }),
        }),
      )(outputs.get("payload"));
      assert.strictEqual(payload._type, "github/ReleasePayload");
      assert.deepStrictEqual(payload.action, {
        _type: "github/ReleaseAction",
        _tag: "published",
      });
      assert.strictEqual(payload.release._type, "github/Release");
      assert.strictEqual(payload.release.tag_name, "v1.0.0");
      assert.deepStrictEqual(payload.release.name, Option.none());
      assert.deepStrictEqual(payload.release.body, Option.some("Release notes"));
      assert.strictEqual(
        (JSON.parse(outputs.get("payloadJson") as string) as { action: string }).action,
        "published",
      );
    }),
  );
});
