import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  Function as GraphFunction,
  GraphId,
  IoId,
  NodeId,
  OutputRef,
  Project,
} from "@macrograph/core";
import { DataType } from "@macrograph/module";
import { Effect, Result } from "effect";

import { Executor } from "../src/index.ts";

const argument: GraphFunction.Field = {
  id: IoId.make("value"),
  name: "Value",
  type: DataType.String,
};
const returned: GraphFunction.Field = {
  id: IoId.make("result"),
  name: "Result",
  type: DataType.String,
};
const connection = (outNodeId: string, outIo: string, inNodeId: string, inIoId: string) => ({
  id: ConnectionId.make(crypto.randomUUID()),
  outNodeId,
  outIo: OutputRef.port(outIo),
  inNodeId,
  inIoId: IoId.make(inIoId),
});
const identity = (id: string): GraphFunction.Model => ({
  canvas: {
    id: GraphId.make(id),
    name: id,
    nodes: {},
    connections: [
      connection(
        GraphFunction.InputBoundaryNodeId,
        GraphFunction.ExecutionIoId,
        GraphFunction.OutputBoundaryNodeId,
        GraphFunction.ExecutionIoId,
      ),
      connection(
        GraphFunction.InputBoundaryNodeId,
        argument.id,
        GraphFunction.OutputBoundaryNodeId,
        returned.id,
      ),
    ],
  },
  arguments: [argument],
  returns: [returned],
  inputPosition: { x: 0, y: 0 },
  outputPosition: { x: 400, y: 0 },
});

describe("function execution", () => {
  it.effect("invokes functions directly and through Execute Function", () =>
    Effect.gen(function* () {
      const leaf = identity("leaf");
      const callId = NodeId.make("call");
      const outer: GraphFunction.Model = {
        ...identity("outer"),
        canvas: {
          ...identity("outer").canvas,
          nodes: {
            [callId]: {
              id: callId,
              name: "Execute Function",
              schema: { package: GraphFunction.packageId, schema: GraphFunction.CallSchemaId },
              properties: { function: leaf.canvas.id },
              inputDefaults: {},
              foldPins: false,
              position: { x: 200, y: 0 },
            },
          },
          connections: [
            connection(
              GraphFunction.InputBoundaryNodeId,
              GraphFunction.ExecutionIoId,
              callId,
              GraphFunction.ExecutionIoId,
            ),
            connection(
              callId,
              GraphFunction.ExecutionIoId,
              GraphFunction.OutputBoundaryNodeId,
              GraphFunction.ExecutionIoId,
            ),
            connection(GraphFunction.InputBoundaryNodeId, argument.id, callId, argument.id),
            connection(callId, returned.id, GraphFunction.OutputBoundaryNodeId, returned.id),
          ],
        },
      };
      const project: Project.Model = {
        ...Project.empty(),
        functions: { leaf, outer },
      };
      const executor = yield* Executor.make(project);

      assert.deepStrictEqual(yield* executor.invokeFunction("leaf", { value: "direct" }), {
        result: "direct",
      });
      assert.deepStrictEqual(yield* executor.invokeFunction("outer", { value: "nested" }), {
        result: "nested",
      });
    }),
  );

  it.effect("reports missing targets and recursion as typed invocation errors", () =>
    Effect.gen(function* () {
      const recursive = identity("recursive");
      const callId = NodeId.make("call");
      const project: Project.Model = {
        ...Project.empty(),
        functions: {
          recursive: {
            ...recursive,
            canvas: {
              ...recursive.canvas,
              nodes: {
                [callId]: {
                  id: callId,
                  name: "Recursive",
                  schema: { package: GraphFunction.packageId, schema: GraphFunction.CallSchemaId },
                  properties: { function: recursive.canvas.id },
                  inputDefaults: {},
                  foldPins: false,
                  position: { x: 200, y: 0 },
                },
              },
              connections: [
                connection(
                  GraphFunction.InputBoundaryNodeId,
                  GraphFunction.ExecutionIoId,
                  callId,
                  GraphFunction.ExecutionIoId,
                ),
                connection(GraphFunction.InputBoundaryNodeId, argument.id, callId, argument.id),
              ],
            },
          },
        },
      };
      const executor = yield* Executor.make(project);
      for (const id of ["missing", "recursive"]) {
        const result = yield* executor.invokeFunction(id, { value: "test" }).pipe(Effect.result);
        assert(Result.isFailure(result));
        if (Result.isFailure(result))
          assert.strictEqual(result.failure._tag, "FunctionInvocationError");
      }
    }),
  );
});
