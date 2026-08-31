import { describe, expect, it } from "@effect/vitest";
import { IoId, PackageId, SchemaId } from "@macrograph/core";
import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Option, Schema } from "effect";

import { Packages } from "../src/Packages.ts";

describe("custom input defaults", () => {
  it.effect("validates and encodes project-scoped nested custom values", () =>
    Effect.gen(function* () {
      const packages = yield* Packages.Service;
      const id = DataType.DefinitionId.make("person");
      const type = DataType.Option(DataType.Custom(id));
      const definitions: DataType.Definitions = {
        person: {
          _tag: "Struct",
          id,
          name: "Person",
          fields: [{ name: "name", type: DataType.String }],
        },
      };
      const ref = { package: PackageId.make("test"), schema: SchemaId.make("sink") };
      yield* packages.loadPackage({
        id: ref.package,
        name: "Test",
        resources: [],
        schemas: [
          {
            id: ref.schema,
            name: "Sink",
            type: "exec",
            properties: [],
            dataInputs: [{ id: IoId.make("value"), type }],
            dataOutputs: [],
            executionInputs: [],
            executionOutputs: [],
          },
        ],
      });
      const value = Option.some({ _type: "person", name: "Ada" });
      const encoded = yield* packages.validateInputDefault(ref, {}, "value", value, definitions);
      expect(
        Schema.decodeUnknownSync(DataType.JsonValueSchema(type, definitions))(encoded),
      ).toEqual(value);
      expect(
        (yield* Effect.flip(packages.validateInputDefault(ref, {}, "value", encoded)))._tag,
      ).toBe("InvalidInputDefaultError");
    }).pipe(Effect.provide(Packages.defaultLayer)),
  );
});
