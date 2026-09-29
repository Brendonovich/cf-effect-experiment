import {
  BuiltinAuthoring,
  NodeIO,
  Package,
  PackageId,
  SchemaRef,
  type SchemaAuthoring,
} from "@macrograph/core";
import { t } from "@macrograph/module";
import { Context, Effect, Layer, Ref, Result, Schema } from "effect";

const SchemaRuntimeKey = Schema.String.pipe(Schema.brand("SchemaRuntimeKey"));
type SchemaRuntimeKey = typeof SchemaRuntimeKey.Type;

export type IOCalculator = (
  properties: Readonly<Record<string, unknown>>,
  definitions: t.Definitions,
  resolve?: (type: t.Type) => t.Type,
) => NodeIO;

export interface SchemaRuntime {
  readonly getIO: IOCalculator;
  readonly declaresProperties?: boolean;
  readonly getSuggestions?: (
    properties: Readonly<Record<string, unknown>>,
    inputDefaults: Readonly<Record<string, unknown>>,
    input: string,
  ) => Effect.Effect<ReadonlyArray<string>, unknown>;
}

/** Manages loaded packages, schema runtimes, node IO, and input/property validation. */
export class Service extends Context.Service<
  Service,
  {
    readonly setTypeDefinitions: (definitions: t.Definitions) => Effect.Effect<void>;
    readonly getTypeDefinitions: (definitions?: t.Definitions) => Effect.Effect<t.Definitions>;
    readonly loadPackage: (
      pkg: Package.Model,
      runtimes?: ReadonlyMap<string, SchemaRuntime>,
    ) => Effect.Effect<void>;
    readonly getPackages: () => Effect.Effect<ReadonlyArray<Package.Model>>;
    readonly getSchema: (
      ref: SchemaRef,
    ) => Effect.Effect<Package.SchemaModel, Package.SchemaNotFoundError>;
    readonly getNodeIO: (
      ref: SchemaRef,
      properties: Readonly<Record<string, unknown>>,
      definitions?: t.Definitions,
      resolve?: (type: t.Type) => t.Type,
    ) => Effect.Effect<NodeIO, Package.SchemaNotFoundError>;
    readonly acceptsInput: (
      ref: SchemaRef,
      input: string,
      type: t.Type,
      definitions?: t.Definitions,
    ) => Effect.Effect<boolean>;
    readonly acceptsOutput: (
      ref: SchemaRef,
      output: string,
      type: t.Type,
      definitions?: t.Definitions,
    ) => Effect.Effect<boolean>;
    readonly normalizeProperties: (
      ref: SchemaRef,
      properties: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<
      Readonly<Record<string, Schema.Json>>,
      Package.SchemaNotFoundError | Package.InvalidPropertyError
    >;
    readonly validateInputDefault: (
      ref: SchemaRef,
      properties: Readonly<Record<string, unknown>>,
      input: string,
      value: unknown,
      definitions?: t.Definitions,
    ) => Effect.Effect<Schema.Json, Package.SchemaNotFoundError | Package.InvalidInputDefaultError>;
    readonly getSuggestions: (
      ref: SchemaRef,
      properties: Readonly<Record<string, unknown>>,
      inputDefaults: Readonly<Record<string, unknown>>,
      input: string,
      definitions?: t.Definitions,
    ) => Effect.Effect<
      ReadonlyArray<string>,
      Package.SchemaNotFoundError | Package.InvalidInputDefaultError
    >;
  }
>()("macrograph/Packages") {}

export const layer = (authoring: SchemaAuthoring.Registry = BuiltinAuthoring.registry) =>
  Layer.effect(Service)(
    Effect.gen(function* () {
      const calculatorKey = (ref: SchemaRef) =>
        SchemaRuntimeKey.make(`${ref.package}\0${ref.schema}`);
      const state = yield* Ref.make<{
        readonly definitions: t.Definitions;
        readonly packages: Map<PackageId, Package.Model>;
        readonly runtimes: Map<SchemaRuntimeKey, SchemaRuntime>;
      }>({
        definitions: {},
        packages: new Map(),
        runtimes: new Map(),
      });
      const definitionsOf = (
        current: {
          readonly definitions: t.Definitions;
          readonly packages: Map<PackageId, Package.Model>;
        },
        provided?: t.Definitions,
      ): t.Definitions => ({
        ...(provided ?? current.definitions),
        ...Object.fromEntries(
          [...current.packages.values()].flatMap((pkg) => Object.entries(pkg.types ?? {})),
        ),
      });

      const loadPackage = Effect.fn("Packages.loadPackage")(function* (
        pkg: Package.Model,
        providedRuntimes?: ReadonlyMap<string, SchemaRuntime>,
      ) {
        yield* Ref.update(state, (current) => {
          const runtimes = new Map(current.runtimes);
          for (const key of runtimes.keys()) {
            if (key.startsWith(`${pkg.id}\0`)) runtimes.delete(key);
          }
          for (const schema of pkg.schemas) {
            const provided = providedRuntimes?.get(schema.id);
            const behavior = authoring.get({ package: pkg.id, schema: schema.id });
            runtimes.set(
              calculatorKey({ package: pkg.id, schema: schema.id }),
              provided ?? {
                declaresProperties: behavior !== undefined,
                getIO: (properties, definitions) => {
                  const declared: NodeIO = {
                    dataInputs: schema.dataInputs,
                    dataOutputs: schema.dataOutputs,
                    executionInputs: schema.executionInputs,
                    executionOutputs: schema.executionOutputs,
                  };
                  const result = behavior?.generateIO?.({
                    declared,
                    properties,
                    definitions,
                    resolve: (type) => type,
                    inputScope: () => undefined,
                  });
                  return result === undefined
                    ? declared
                    : Result.isSuccess(result)
                      ? result.success
                      : {
                          dataInputs: [],
                          dataOutputs: [],
                          executionInputs: [],
                          executionOutputs: [],
                        };
                },
              },
            );
          }
          return {
            ...current,
            packages: new Map(current.packages).set(pkg.id, pkg),
            runtimes,
          };
        });
      });

      const setTypeDefinitions = Effect.fn("Packages.setTypeDefinitions")(function* (
        definitions: t.Definitions,
      ) {
        yield* Ref.update(state, (current) => ({ ...current, definitions }));
      });

      const getTypeDefinitions = (definitions?: t.Definitions) =>
        Ref.get(state).pipe(Effect.map((current) => definitionsOf(current, definitions)));

      const getPackages = Effect.fn("Packages.getPackages")(function* () {
        return Array.from((yield* Ref.get(state)).packages.values());
      });

      const getSchema = Effect.fn("Packages.getSchema")(function* (ref: SchemaRef) {
        const pkg = (yield* Ref.get(state)).packages.get(ref.package);
        if (!pkg) {
          return yield* Effect.fail(new Package.SchemaNotFoundError({ ref }));
        }
        const schema = pkg.schemas.find((s) => s.id === ref.schema);
        if (!schema) {
          return yield* Effect.fail(new Package.SchemaNotFoundError({ ref }));
        }
        return schema;
      });

      const getNodeIO = Effect.fn("Packages.getNodeIO")(function* (
        ref: SchemaRef,
        properties: Readonly<Record<string, unknown>>,
        definitions?: t.Definitions,
        resolve?: (type: t.Type) => t.Type,
      ) {
        const current = yield* Ref.get(state);
        const schema = current.packages
          .get(ref.package)
          ?.schemas.find((candidate) => candidate.id === ref.schema);
        if (schema === undefined) return yield* new Package.SchemaNotFoundError({ ref });
        const runtime = current.runtimes.get(calculatorKey(ref));
        if (runtime === undefined) return yield* new Package.SchemaNotFoundError({ ref });
        return runtime.getIO(properties, definitionsOf(current, definitions), resolve);
      });

      const normalizeProperties = Effect.fn("Packages.normalizeProperties")(function* (
        ref: SchemaRef,
        properties: Readonly<Record<string, unknown>>,
      ) {
        const schema = yield* getSchema(ref);
        const runtime = (yield* Ref.get(state)).runtimes.get(calculatorKey(ref));
        if (schema.properties.length === 0 && runtime?.declaresProperties !== true) {
          const normalized: Record<string, Schema.Json> = {};
          for (const [property, value] of Object.entries(properties)) {
            normalized[property] = yield* Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
              Effect.catchTag(
                "SchemaError",
                () =>
                  new Package.InvalidPropertyError({
                    property,
                    reason: "Property must be JSON serializable",
                  }),
              ),
            );
          }
          return normalized;
        }
        const definitions = new Map(schema.properties.map((property) => [property.id, property]));
        for (const property of Object.keys(properties).sort()) {
          if (!definitions.has(property)) {
            return yield* new Package.InvalidPropertyError({
              property,
              reason: "Property is not declared by the schema",
            });
          }
        }
        const normalized: Record<string, Schema.Json> = {};
        for (const definition of schema.properties) {
          if (Object.hasOwn(properties, definition.id)) {
            const value = properties[definition.id];
            if ("resource" in definition) {
              if (typeof value !== "string") {
                return yield* new Package.InvalidPropertyError({
                  property: definition.id,
                  reason: "Expected a resource constant id",
                });
              }
              normalized[definition.id] = value;
              continue;
            }
            if ("function" in definition) {
              if (typeof value !== "string" || value.length === 0) {
                return yield* new Package.InvalidPropertyError({
                  property: definition.id,
                  reason: "Expected a function id",
                });
              }
              normalized[definition.id] = value;
              continue;
            }
            if (!t.isValue(definition.type, value)) {
              return yield* new Package.InvalidPropertyError({
                property: definition.id,
                reason: `Expected ${definition.type._tag}`,
              });
            }
            normalized[definition.id] = yield* Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
              Effect.catchTag(
                "SchemaError",
                () =>
                  new Package.InvalidPropertyError({
                    property: definition.id,
                    reason: "Property must be JSON serializable",
                  }),
              ),
            );
          } else if ("resource" in definition) {
            continue;
          } else if ("function" in definition) {
            if (!definition.optional)
              return yield* new Package.InvalidPropertyError({
                property: definition.id,
                reason: "Required property has no value",
              });
            continue;
          } else if (definition.defaultValue !== undefined) {
            if (!t.isValue(definition.type, definition.defaultValue)) {
              return yield* new Package.InvalidPropertyError({
                property: definition.id,
                reason: `Schema default does not match ${definition.type._tag}`,
              });
            }
            normalized[definition.id] = definition.defaultValue;
          } else if (!definition.optional) {
            return yield* new Package.InvalidPropertyError({
              property: definition.id,
              reason: "Required property has no value",
            });
          }
        }
        return normalized;
      });

      const acceptsInput = (
        ref: SchemaRef,
        input: string,
        type: t.Type,
        definitions?: t.Definitions,
      ) =>
        Ref.get(state).pipe(
          Effect.map(
            (current) =>
              authoring
                .get(ref)
                ?.acceptsInput?.(input, type, definitionsOf(current, definitions)) !== false,
          ),
        );

      const acceptsOutput = (
        ref: SchemaRef,
        output: string,
        type: t.Type,
        definitions?: t.Definitions,
      ) =>
        Ref.get(state).pipe(
          Effect.map(
            (current) =>
              authoring
                .get(ref)
                ?.acceptsOutput?.(output, type, definitionsOf(current, definitions)) !== false,
          ),
        );

      const getDataInput = Effect.fn("Packages.getDataInput")(function* (
        ref: SchemaRef,
        properties: Readonly<Record<string, unknown>>,
        input: string,
      ) {
        const io = yield* getNodeIO(ref, properties);
        const matches = io.dataInputs.filter((candidate) => candidate.id === input);
        if (
          matches.length !== 1 ||
          io.executionInputs.some((candidate) => candidate.id === input)
        ) {
          return yield* new Package.InvalidInputDefaultError({
            input,
            reason: "Input is not an unambiguous data input",
          });
        }
        return matches[0]!;
      });

      const validateInputDefault = Effect.fn("Packages.validateInputDefault")(function* (
        ref: SchemaRef,
        properties: Readonly<Record<string, unknown>>,
        input: string,
        value: unknown,
        providedDefinitions?: t.Definitions,
      ) {
        const current = yield* Ref.get(state);
        const definitions = definitionsOf(current, providedDefinitions);
        const port = yield* getDataInput(ref, properties, input);
        const codec = t.JsonValueSchema(port.type, definitions);
        const decoded = yield* Schema.decodeUnknownEffect(codec)(value).pipe(
          Effect.catchTag("SchemaError", () =>
            Schema.decodeUnknownEffect(t.ValueSchema(port.type, definitions))(value),
          ),
          Effect.catchTag(
            "SchemaError",
            () =>
              new Package.InvalidInputDefaultError({
                input,
                reason: `Expected ${port.type._tag}`,
              }),
          ),
        );
        const encoded = yield* Schema.encodeUnknownEffect(codec)(decoded).pipe(
          Effect.catchTag(
            "SchemaError",
            () =>
              new Package.InvalidInputDefaultError({
                input,
                reason: `Expected ${port.type._tag}`,
              }),
          ),
        );
        return yield* Schema.decodeUnknownEffect(Schema.Json)(encoded).pipe(
          Effect.catchTag(
            "SchemaError",
            () =>
              new Package.InvalidInputDefaultError({
                input,
                reason: "Input default is not JSON serializable",
              }),
          ),
        );
      });

      const getSuggestions = Effect.fn("Packages.getSuggestions")(function* (
        ref: SchemaRef,
        properties: Readonly<Record<string, unknown>>,
        inputDefaults: Readonly<Record<string, unknown>>,
        input: string,
        providedDefinitions?: t.Definitions,
      ) {
        const current = yield* Ref.get(state);
        const definitions = definitionsOf(current, providedDefinitions);
        const port = yield* getDataInput(ref, properties, input);
        if (!port.suggestions || port.type._tag !== "String") {
          return yield* new Package.InvalidInputDefaultError({
            input,
            reason: "Input does not declare suggestions",
          });
        }
        const runtime = (yield* Ref.get(state)).runtimes.get(calculatorKey(ref));
        const resolver = runtime?.getSuggestions;
        const io = yield* getNodeIO(ref, properties);
        const decodedDefaults: Record<string, unknown> = {};
        for (const [id, value] of Object.entries(inputDefaults)) {
          const inputs = io.dataInputs.filter((candidate) => candidate.id === id);
          if (inputs.length !== 1 || io.executionInputs.some((candidate) => candidate.id === id)) {
            continue;
          }
          decodedDefaults[id] = yield* Schema.decodeUnknownEffect(
            t.JsonValueSchema(inputs[0]!.type, definitions),
          )(value).pipe(
            Effect.catchTag(
              "SchemaError",
              () =>
                new Package.InvalidInputDefaultError({
                  input: id,
                  reason: `Stored default does not match ${inputs[0]!.type._tag}`,
                }),
            ),
          );
        }
        const suggestions =
          resolver === undefined
            ? undefined
            : yield* Effect.suspend(() => resolver(properties, decodedDefaults, input)).pipe(
                Effect.catchCause(
                  () =>
                    new Package.InvalidInputDefaultError({
                      input,
                      reason: "Suggestion resolver failed",
                    }),
                ),
              );
        if (
          suggestions === undefined ||
          !Array.isArray(suggestions) ||
          suggestions.some((value) => typeof value !== "string")
        ) {
          return yield* new Package.InvalidInputDefaultError({
            input,
            reason: "Suggestion resolver returned invalid values",
          });
        }
        return [...suggestions];
      });

      for (const pkg of authoring.packages) yield* loadPackage(pkg.model);

      return Service.of({
        setTypeDefinitions,
        getTypeDefinitions,
        loadPackage,
        getPackages,
        getSchema,
        getNodeIO,
        acceptsInput,
        acceptsOutput,
        normalizeProperties,
        validateInputDefault,
        getSuggestions,
      });
    }),
  );

export const defaultLayer = layer();

export * as Packages from "./Packages.ts";
