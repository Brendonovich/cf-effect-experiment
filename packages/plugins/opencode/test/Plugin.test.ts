import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import { OpenCodeModel } from "../src/Definition.ts";
import plugin from "../src/Plugin.ts";

describe("OpenCode nodes", () => {
  it.effect("registers model resource properties instead of model input pins", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map(({ id }) => id),
        ["CreateSession", "PromptSession", "WaitForSession"],
      );
      for (const schema of schemas)
        assert.deepStrictEqual(
          schema.properties.map(({ id }) => id),
          schema.id === "WaitForSession" ? ["connection"] : ["connection", "model"],
        );
      for (const schemaId of ["CreateSession", "PromptSession"]) {
        const schema = schemas.find(({ id }) => id === schemaId);
        assert.isDefined(schema);
        const property = schema.properties.find(({ id }) => id === "model");
        assert.isDefined(property);
        assert.isTrue("resource" in property);
        if ("resource" in property) assert.strictEqual(property.resourceClass, OpenCodeModel);
        assert.isFalse(schema.dataInputs.some(({ id }) => id === "model"));
        if (schema.id === "CreateSession")
          assert.strictEqual(schema.dataInputs.find(({ id }) => id === "text")?.defaultValue, "");
      }
    }),
  );

  it.effect("passes the selected model and only queues non-empty initial prompts", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      for (const schema of schemas.filter(({ id }) => id !== "WaitForSession")) {
        for (const model of ["", "provider/model"]) {
          for (const text of schema.id === "CreateSession"
            ? ["", " \n\t ", " Hello \n"]
            : ["Hello"]) {
            const calls: Array<unknown> = [];
            const output = new Map<string, unknown>();
            const call = (payload: unknown) =>
              Effect.sync(() => {
                calls.push(payload);
                return "result";
              });
            yield* schema.run({
              input: (ref) =>
                ref.id === "text"
                  ? text
                  : ref.id === "sessionID"
                    ? "ses_example"
                    : ref.defaultValue,
              output: (ref, value) => {
                output.set(ref.id, value);
              },
              properties: { connection: "local", model },
              event: undefined,
              engine: { OpenCodeCreateSession: call, OpenCodePromptSession: call },
              execution: {
                projectId: "project",
                graphId: "graph",
                eventNodeId: "event",
                traceId: "execution",
              },
              node: {
                nodeId: "node",
                kind: schema.type,
                executionPath: "event:event",
                traceId: "node",
                withSpan: (_name, effect) => effect,
              },
            });
            assert.deepStrictEqual(
              calls,
              schema.id === "CreateSession"
                ? [
                    { connection: "local", directory: "", title: "", model },
                    ...(text.trim()
                      ? [{ connection: "local", sessionID: "result", text, model: "" }]
                      : []),
                  ]
                : [{ connection: "local", sessionID: "ses_example", text, model }],
            );
            assert.strictEqual(
              output.get(schema.id === "CreateSession" ? "sessionID" : "inboxID"),
              "result",
            );
          }
        }
      }
    }),
  );

  it.effect("suggests session IDs from the selected connection", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      const suggest = schemas
        .find(({ id }) => id === "PromptSession")
        ?.dataInputs.find(({ id }) => id === "sessionID")?.suggestions;
      assert.isDefined(suggest);
      const values = yield* suggest({
        properties: { connection: "remote" },
        inputDefaults: {},
        engine: {
          OpenCodeSessions: (payload: unknown) =>
            Effect.sync(() => {
              assert.deepStrictEqual(payload, { connection: "remote" });
              return [{ id: "ses_example", title: "Example" }];
            }),
        },
      });
      assert.deepStrictEqual(values, ["ses_example"]);
    }),
  );
});
