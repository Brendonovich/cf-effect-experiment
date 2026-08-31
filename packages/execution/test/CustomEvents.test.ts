import { expect, it } from "@effect/vitest";
import {
  ConnectionId,
  CustomEvent,
  Graph,
  GraphId,
  IoId,
  Node,
  NodeId,
  PackageId,
  Project,
  SchemaId,
} from "@macrograph/core";
import { DataType, Engine, Plugin } from "@macrograph/plugin";
import { Deferred, Effect, Exit, Ref, Schema, Scope } from "effect";

import { Executor, RuntimeActivity } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {}) {}
class TestEngine extends Engine.make({ events: [new Trigger()] }) {}
const node = (
  id: string,
  pkg: string,
  schema: string,
  inputDefaults: Node.Model["inputDefaults"] = {},
): Node.Model => ({
  id: NodeId.make(id),
  name: id,
  schema: { package: PackageId.make(pkg), schema: SchemaId.make(schema) },
  properties: {},
  inputDefaults,
  foldPins: false,
  position: { x: 0, y: 0 },
});
const connection = (from: string, out: string, to: string, input: string) => ({
  id: ConnectionId.make(`${from}-${out}-${to}-${input}`),
  outNodeId: from,
  outIoId: IoId.make(out),
  inNodeId: to,
  inIoId: IoId.make(input),
});
const graph = (
  id: string,
  nodes: Node.Model[],
  connections: Graph.Model["connections"],
): Graph.Model => ({
  id: GraphId.make(id),
  name: id,
  nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  connections,
});

it.effect(
  "emits across graphs without waiting, isolates handler failure, gives separate executions, and retains emission snapshot",
  () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const received = yield* Deferred.make<string>();
      const failed = yield* Deferred.make<void>();
      const activity = yield* RuntimeActivity.Service;
      const plugin = Plugin.make({
        id: "test",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (ctx) {
          yield* ctx.schema.register({
            id: "trigger",
            type: "event",
            event: () => Effect.succeed(true),
            io: () => ({}),
            run: () => Effect.void,
          });
          yield* ctx.schema.register({
            id: "receive",
            io: (io) => ({ message: io.data.in("message", DataType.String) }),
            run: ({ io }) =>
              Deferred.await(gate).pipe(
                Effect.andThen(Deferred.succeed(received, io.message)),
                Effect.asVoid,
              ),
          });
          yield* ctx.schema.register({
            id: "fail",
            io: () => ({}),
            run: () =>
              Deferred.succeed(failed, undefined).pipe(
                Effect.andThen(Effect.fail("handler failed")),
              ),
          });
        }),
      });
      const event: CustomEvent.Model = {
        id: "greeting",
        name: "Greeting",
        fields: [{ id: "message", name: "Message", type: DataType.String }],
      };
      const project: Project.Model = {
        ...Project.empty(),
        customEvents: { greeting: event },
        graphs: {
          emit: graph(
            "emit",
            [
              node("trigger", "test", "trigger"),
              node("emit", "project-events", "emit:greeting", { "field:message": "hello" }),
            ],
            [connection("trigger", "exec", "emit", "exec")],
          ),
          receive: graph(
            "receive",
            [node("on", "project-events", "on:greeting"), node("receive", "test", "receive")],
            [
              connection("on", "exec", "receive", "exec"),
              connection("on", "field:message", "receive", "message"),
            ],
          ),
          fail: graph(
            "fail",
            [node("on-fail", "project-events", "on:greeting"), node("fail", "test", "fail")],
            [connection("on-fail", "exec", "fail", "exec")],
          ),
        },
      };
      const scope = yield* Effect.scope;
      const executor = yield* Executor.make(project, {
        executionDriver: activity.executionDriver,
        customEvents: {
          scope,
          track: (name, payload, handler) =>
            activity.track("project-events", { _tag: name, payload }, handler),
        },
      });
      yield* executor.plugin(
        plugin,
        Engine.deployment(
          plugin,
          TestEngine.toLayer(() => Effect.die("unused")),
        ),
      );
      yield* executor.handleEvent(plugin, new Trigger());
      yield* Deferred.await(failed);
      expect(yield* Deferred.isDone(received)).toBe(false);
      yield* executor.loadProject(Project.empty());
      yield* Deferred.succeed(gate, undefined);
      expect(yield* Deferred.await(received)).toBe("hello");
      yield* Effect.yieldNow;
      const events = yield* activity.snapshot;
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.status).sort()).toEqual(["complete", "failed"]);
      expect(
        new Set(events.flatMap((event) => event.nodes.map((node) => node.executionId))).size,
      ).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(RuntimeActivity.layer)),
);

it.effect("does not register project event nodes on hosts without explicit support", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    const plugin = Plugin.make({
      id: "test",
      engine: TestEngine,
      effect: (ctx) =>
        ctx.schema.register({
          id: "trigger",
          type: "event",
          event: () => Effect.succeed(true),
          io: () => ({}),
          run: () => Ref.update(calls, (n) => n + 1),
        }),
    });
    const executor = yield* Executor.make({
      ...Project.empty(),
      graphs: {
        emit: graph(
          "emit",
          [node("trigger", "test", "trigger"), node("emit", "project-events", "emit:missing")],
          [connection("trigger", "exec", "emit", "exec")],
        ),
      },
    });
    yield* executor.plugin(
      plugin,
      Engine.deployment(
        plugin,
        TestEngine.toLayer(() => Effect.die("unused")),
      ),
    );
    expect(Exit.isFailure(yield* Effect.exit(executor.handleEvent(plugin, new Trigger())))).toBe(
      true,
    );
  }),
);

it.effect("interrupts independent handlers when the owning runtime closes", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const scope = yield* Scope.make();
    const plugin = Plugin.make({
      id: "test",
      engine: TestEngine,
      effect: Effect.fnUntraced(function* (ctx) {
        yield* ctx.schema.register({
          id: "trigger",
          type: "event",
          event: () => Effect.succeed(true),
          io: () => ({}),
          run: () => Effect.void,
        });
        yield* ctx.schema.register({
          id: "wait",
          io: () => ({}),
          run: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            ),
        });
      }),
    });
    const executor = yield* Executor.make(
      {
        ...Project.empty(),
        customEvents: { event: { id: "event", name: "Event", fields: [] } },
        graphs: {
          emit: graph(
            "emit",
            [node("trigger", "test", "trigger"), node("emit", "project-events", "emit:event")],
            [connection("trigger", "exec", "emit", "exec")],
          ),
          receive: graph(
            "receive",
            [node("on", "project-events", "on:event"), node("wait", "test", "wait")],
            [connection("on", "exec", "wait", "exec")],
          ),
        },
      },
      { customEvents: { scope, track: (_name, _payload, handler) => handler } },
    );
    yield* executor.plugin(
      plugin,
      Engine.deployment(
        plugin,
        TestEngine.toLayer(() => Effect.die("unused")),
      ),
    );
    yield* executor.handleEvent(plugin, new Trigger());
    yield* Deferred.await(started);
    yield* Scope.close(scope, Exit.void);
    expect(yield* Deferred.isDone(interrupted)).toBe(true);
  }),
);
