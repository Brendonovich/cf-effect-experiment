import { expect, it } from "@effect/vitest";
import { FunctionGraph, PackageId, Project, SchemaId } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer, Result } from "effect";

import { Editor, Packages } from "../src/index.ts";

const layer = Editor.defaultLayer.pipe(
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);
it.layer(layer)((it) => {
  it.effect("treats function references as ordinary schema properties", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;
      yield* persistence.saveProject(Project.empty());
      const editor = yield* Editor.Service;
      const packages = yield* Packages.Service;
      yield* packages.loadPackage({
        id: PackageId.make("function-property-test"),
        name: "Function Property Test",
        resources: [],
        schemas: [
          {
            id: SchemaId.make("consumer"),
            name: "Consumer",
            type: "exec",
            properties: [
              { id: "target", name: "Function", function: true, optional: true },
            ],
            dataInputs: [],
            dataOutputs: [],
            executionInputs: [],
            executionOutputs: [],
          },
        ],
      });
      const target = yield* editor.graph.create({ kind: "function", name: "Target" });
      const graph = yield* editor.graph.create({});
      const created = yield* editor.node.create({
        graphID: graph.graph.id,
        node: {
          schema: {
            package: PackageId.make("function-property-test"),
            schema: SchemaId.make("consumer"),
          },
          properties: { target: target.graph.id },
        },
      });
      expect(created.node.properties.target).toBe(target.graph.id);
      const invalid = yield* editor.node
        .create({
          graphID: graph.graph.id,
          node: { ...created.node, properties: { target: graph.graph.id } },
        })
        .pipe(Effect.result);
      expect(invalid._tag).toBe("Failure");
      if (Result.isFailure(invalid)) expect(invalid.failure._tag).toBe("InvalidPropertyError");
    }),
  );

  it.effect("generates protected boundaries, hydrates IO, and retains in-use data", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;
      yield* persistence.saveProject(Project.empty());
      const editor = yield* Editor.Service;
      const created = yield* editor.graph.create({
        kind: "function",
        name: "Identity",
        signature: {
          inputs: [{ id: "arg", name: "Argument", type: { _tag: "String" } }],
          outputs: [],
        },
      });
      const boundaries = Object.values(created.graph.nodes);
      expect(boundaries).toHaveLength(2);
      expect(created.graph.connections).toHaveLength(1);
      expect(Object.keys(created.nodeIO ?? {})).toHaveLength(2);
      const input = boundaries.find((node) => node.schema.schema === "input")!;
      expect(created.nodeIO?.[input.id]?.dataOutputs[0]?.id).toBe("gin:arg");
      const protectedMutations: ReadonlyArray<Effect.Effect<unknown, { readonly _tag: string }>> = [
        editor.node.delete({ graphID: created.graph.id, nodeID: input.id }),
        editor.node.create({ graphID: created.graph.id, node: { schema: input.schema } }),
        editor.graph.create({ nodes: { [input.id]: input } }),
      ];
      for (const mutation of protectedMutations) {
        const result = yield* mutation.pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure._tag).toBe("FunctionError");
      }
      const ordinary = yield* editor.graph.create({});
      const call = yield* editor.node.create({
        graphID: ordinary.graph.id,
        node: {
          schema: { package: FunctionGraph.packageId, schema: SchemaId.make("call") },
          properties: { function: created.graph.id },
          inputDefaults: { "in:arg": "saved" },
        },
      });
      expect(call.io.dataInputs[0]?.id).toBe("in:arg");
      const renamed = yield* editor.graph.setSignature(created.graph.id, {
        inputs: [{ id: "arg", name: "Renamed", type: { _tag: "String" } }],
        outputs: [],
      });
      expect(renamed.nodeIO[ordinary.graph.id]?.[call.node.id]?.dataInputs[0]?.name).toBe(
        "Renamed",
      );
      const destructiveMutations: ReadonlyArray<Effect.Effect<unknown, { readonly _tag: string }>> =
        [
          editor.graph.delete({ graphID: created.graph.id }),
          editor.graph.setSignature(created.graph.id, { inputs: [], outputs: [] }),
          editor.node.clearProperty({
            graphID: ordinary.graph.id,
            nodeID: call.node.id,
            property: "function",
          }),
        ];
      for (const mutation of destructiveMutations) {
        const result = yield* mutation.pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
      }
      const snapshot = yield* editor.project.snapshot();
      expect(
        snapshot.project.graphs[ordinary.graph.id]?.nodes[call.node.id]?.inputDefaults["in:arg"],
      ).toBe("saved");
      expect(snapshot.nodeIO[created.graph.id]?.[input.id]?.dataOutputs[0]?.id).toBe("gin:arg");
      const copied = yield* editor.node.create({ graphID: ordinary.graph.id, node: call.node });
      expect(copied.node.properties.function).toBe(created.graph.id);
      expect(
        (yield* editor.node
          .create({
            graphID: ordinary.graph.id,
            node: { schema: call.node.schema, properties: { function: "missing" } },
          })
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      const before = (yield* editor.project.get()).graphs[ordinary.graph.id];
      const impact = yield* editor.graph
        .setSignature(created.graph.id, { inputs: [], outputs: [] })
        .pipe(Effect.flip);
      expect(impact._tag).toBe("FunctionImpact");
      yield* editor.graph.setSignature(created.graph.id, { inputs: [], outputs: [] }, true);
      expect((yield* editor.project.get()).graphs[ordinary.graph.id]).toEqual(before);
      const deleteImpact = yield* editor.graph
        .delete({ graphID: created.graph.id })
        .pipe(Effect.flip);
      expect(deleteImpact._tag).toBe("FunctionImpact");
      yield* editor.graph.delete({ graphID: created.graph.id, force: true });
      expect((yield* editor.project.get()).graphs[ordinary.graph.id]).toEqual(before);
      expect((yield* editor.project.get()).graphs[created.graph.id]).toBeUndefined();
    }),
  );
});
