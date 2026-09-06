import {
  BuiltinAuthoring,
  CustomTypes,
  IoId,
  PackageId,
  SchemaId,
  type Package,
} from "@macrograph/core";
import { DataType as t } from "@macrograph/module/DataType";
import { Effect, Result } from "effect";
import { expect, it } from "vitest";

import { Packages } from "../src/Packages.ts";

it("evaluates shared authoring against current definitions without rebuilding its catalog", async () => {
  const model: Package.Model = {
    id: PackageId.make("authoring-test"),
    name: "Authoring test",
    resources: [],
    schemas: [
      {
        id: SchemaId.make("Fields"),
        name: "Fields",
        type: "pure",
        properties: [
          { id: "record", name: "Record", type: t.String, optional: false, defaultValue: "" },
        ],
        dataInputs: [],
        dataOutputs: [],
        executionInputs: [],
        executionOutputs: [],
      },
    ],
  };
  const registry = BuiltinAuthoring.registry.with({
    model,
    schemas: {
      Fields: {
        generateIO: ({ properties, definitions, declared }) => {
          const definition =
            typeof properties.record === "string" ? definitions[properties.record] : undefined;
          return Result.succeed({
            ...declared,
            dataInputs:
              definition?._tag === "Struct"
                ? definition.fields.map((field) => ({
                    id: IoId.make(field.name),
                    type: field.type,
                  }))
                : [],
          });
        },
      },
    },
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const packages = yield* Packages.Service;
      const ref = { package: model.id, schema: SchemaId.make("Fields") };
      const before = yield* packages.getPackages();
      expect(before.find((pkg) => pkg.id === CustomTypes.packageId)).toBe(CustomTypes.packageModel);
      expect((yield* packages.getNodeIO(ref, { record: "item" })).dataInputs).toEqual([]);
      yield* packages.setTypeDefinitions({
        item: {
          _tag: "Struct",
          id: t.DefinitionId.make("item"),
          name: "Item",
          fields: [{ name: "count", type: t.Int }],
        },
      });
      expect((yield* packages.getNodeIO(ref, { record: "item" })).dataInputs).toEqual([
        { id: "count", type: t.Int },
      ]);
      expect((yield* packages.getNodeIO(ref, { record: "item" }, {})).dataInputs).toEqual([]);
      const after = yield* packages.getPackages();
      for (const [index, pkg] of before.entries()) expect(after[index]).toBe(pkg);
      yield* packages.setTypeDefinitions({});
      expect((yield* packages.getNodeIO(ref, { record: "item" })).dataInputs).toEqual([]);
    }).pipe(Effect.provide(Packages.layer(registry))),
  );
});
