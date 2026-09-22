import { assert, describe, it } from "@effect/vitest";
import { Context } from "effect";
import { Tool } from "effect/unstable/ai";

import { toolkit } from "../src/ServerMcp.ts";

describe("Server MCP toolkit", () => {
  it("exposes single-project graph editing tools", () => {
    assert.deepStrictEqual(Object.keys(toolkit.tools), [
      "listGraphs",
      "getGraph",
      "createGraph",
      "deleteGraph",
      "searchSchemas",
      "listResources",
      "createNode",
      "createConnection",
    ]);
  });

  it("uses compound graph creation without cloud project parameters", () => {
    const schema = Tool.getJsonSchema(toolkit.tools.createGraph);
    assert.include(Tool.getDescription(toolkit.tools.createGraph), "PREFERRED");
    assert.containsAllKeys(schema.properties, ["name", "nodes", "connections"]);
    assert.notProperty(schema.properties, "projectId");
  });

  it("marks read-only and destructive tools", () => {
    assert.isTrue(Context.get(toolkit.tools.listGraphs.annotations, Tool.Readonly));
    assert.isTrue(Context.get(toolkit.tools.getGraph.annotations, Tool.Readonly));
    assert.isTrue(Context.get(toolkit.tools.searchSchemas.annotations, Tool.Readonly));
    assert.isTrue(Context.get(toolkit.tools.listResources.annotations, Tool.Readonly));
    assert.isTrue(Context.get(toolkit.tools.deleteGraph.annotations, Tool.Destructive));
  });

  it("exposes bounded multi-query schema discovery", () => {
    const schema = Tool.getJsonSchema(toolkit.tools.searchSchemas);
    assert.containsAllKeys(schema.properties, ["query", "queries", "limit"]);
    assert.notProperty(schema.properties, "projectId");
    assert.deepStrictEqual(schema.required ?? [], []);
  });
});
