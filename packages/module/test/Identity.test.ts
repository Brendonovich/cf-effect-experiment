import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { t, Engine, Module, ModuleId, Registration, Resource } from "../src/index.ts";

const moduleId = ModuleId.Id.make("local/alice/thing");

describe("module identity", () => {
  it("builds built-in ids in the official namespace", () => {
    assert.strictEqual(Module.builtinId("twitch"), "macrograph.app/macrograph/twitch");
    assert.strictEqual(
      Module.builtinIdFromPackage("@macrograph/module-http-client"),
      "macrograph.app/macrograph/http-client",
    );
    const module = Module.identify(moduleId, Module.make({ effect: () => Effect.void }));
    assert.strictEqual(module.id, moduleId);
    assert.strictEqual(Module.displayName(module), "local/alice/thing");
  });

  it("derives engine and resource service keys from the module id", () => {
    class Account extends Resource.make<Account, string>()("account", { name: "Account" }) {}
    class TestEngine extends Engine.make({ resources: [Account] }) {}
    const module = Module.make({ engine: TestEngine, effect: () => Effect.void });
    const deployment = Engine.identify(
      moduleId,
      Engine.deployment(
        module,
        TestEngine.toLayer(() => Effect.die("unused")),
      ),
    );
    assert.strictEqual(deployment.moduleId, moduleId);
    assert.strictEqual(deployment.module.id, moduleId);
    assert.strictEqual(TestEngine.key, `macrograph/Module/Engine/${moduleId}`);
    assert.strictEqual(TestEngine.EngineContext.key, `macrograph/Module/EngineContext/${moduleId}`);
    assert.strictEqual(Account.Handler.key, `macrograph/Module/Resource/${moduleId}/account`);
    // Binding again to the same id is allowed; a different id is not.
    Engine.identify(moduleId, deployment);
    assert.throws(() => Engine.bind(TestEngine, ModuleId.Id.make("local/bob/thing")));
  });

  it("refuses to bind an engine whose key was already used unbound", () => {
    class Unbound extends Engine.make({}) {}
    assert.match(Unbound.key, /^macrograph\/Module\/Engine\/unbound\//);
    assert.throws(() => Engine.bind(Unbound, moduleId));
  });

  it("recognizes port refs by brand instead of instanceof", () => {
    const foreign = {
      [Symbol.for("~macrograph/Module/Registration/Port")]: Symbol.for(
        "~macrograph/Module/Registration/Port",
      ),
      _tag: "DataInput",
      id: "value",
      type: t.Int,
    };
    assert.isTrue(Registration.isPort(foreign));
    assert.isTrue(Registration.isDataInput(foreign));
    assert.isFalse(Registration.isPort({ _tag: "DataInput", id: "value" }));
    const scope = new Registration.ScopeOutputRef("out", []);
    assert.isTrue(Registration.isScopeOutput(scope));
    assert.isFalse(Registration.isScopeOutput(new Registration.ExecutionOutputRef("out")));
    assert.isTrue(
      Registration.isScopeExecution(new Registration.ScopeExecution(scope, { value: 1 })),
    );
  });

  it.effect("scopes a module's own types to its id while module code keeps local ids", () =>
    Effect.gen(function* () {
      const Point = t.defineStruct("Point", "Point", { x: t.Int });
      const seen: Array<unknown> = [];
      const collected = yield* Registration.collectModule(
        (context) =>
          context.schema.register({
            id: "echo",
            type: "pure",
            io: (io) => ({
              input: io.data.in("in", t.Struct(Point)),
              output: io.data.out("out", t.Option(t.Struct(Point))),
            }),
            run: ({ io }) =>
              Effect.sync(() => {
                seen.push(io.input);
                io.output(Option.some({ x: 2, _type: Point.id }));
              }),
          }),
        { moduleId, types: { [Point.id]: Point } },
      );
      const qualified = `${moduleId}/Point`;
      assert.deepStrictEqual(Object.keys(collected.types), [qualified]);
      assert.strictEqual(collected.types[qualified]!.id, qualified);
      const schema = collected.schemas[0]!;
      const io = schema.generateIO({});
      assert.deepStrictEqual(io.dataInputs[0]!.type, t.Struct(qualified));
      assert.deepStrictEqual(io.dataOutputs[0]!.type, t.Option(t.Struct(qualified)));
      const outputs: Array<unknown> = [];
      yield* schema.run({
        input: () => ({ x: 1, _type: qualified }),
        output: (_ref, value) => outputs.push(value),
        properties: {},
        event: undefined,
        engine: undefined,
        execution: { projectId: "p", graphId: "g", eventNodeId: "e", traceId: "t" },
        node: {
          nodeId: "n",
          kind: "exec",
          executionPath: "",
          traceId: "t",
          withSpan: (_name, effect) => effect,
        },
      });
      assert.deepStrictEqual(seen, [{ x: 1, _type: "Point" }]);
      assert.deepStrictEqual(outputs, [Option.some({ x: 2, _type: qualified })]);
    }),
  );
});
