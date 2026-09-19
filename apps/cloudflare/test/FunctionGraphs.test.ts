import type { Executor } from "@macrograph/execution";

import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  Function as GraphFunction,
  GraphId,
  IoId,
  NodeId,
  OutputRef,
  PackageId,
  Project,
  RenderedProject,
  SchemaId,
} from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import { ProjectExecutor } from "@macrograph/project-host";
import { Effect, Schema } from "effect";

import * as ExecutorModules from "../src/execution/ExecutorModules.ts";

describe("hosted function graphs", () => {
  it.effect("executes a deployed function call from an event graph", () =>
    Effect.gen(function* () {
      const functionId = GraphId.make("identity");
      const graphId = GraphId.make("cloud-event");
      const tickId = NodeId.make("tick");
      const callId = NodeId.make("call-function");
      const value = { id: IoId.make("value"), name: "Value", type: DataType.String };
      const boundaryConnection = (outIo: string, inIoId: string) => ({
        id: ConnectionId.make(crypto.randomUUID()),
        outNodeId: GraphFunction.InputBoundaryNodeId,
        outIo: OutputRef.port(outIo),
        inNodeId: GraphFunction.OutputBoundaryNodeId,
        inIoId: IoId.make(inIoId),
      });
      const fn: GraphFunction.Model = {
        canvas: {
          id: functionId,
          name: "Identity",
          nodes: {},
          connections: [
            boundaryConnection(GraphFunction.ExecutionIoId, GraphFunction.ExecutionIoId),
            boundaryConnection(value.id, value.id),
          ],
        },
        arguments: [value],
        returns: [value],
        inputPosition: { x: 0, y: 0 },
        outputPosition: { x: 400, y: 0 },
      };
      const project: Project.Model = {
        ...Project.empty(),
        graphs: {
          [graphId]: {
            canvas: {
              id: graphId,
              name: "Cloud event",
              nodes: {
                [tickId]: {
                  id: tickId,
                  name: "Tick",
                  schema: { package: PackageId.make("util"), schema: SchemaId.make("Tick") },
                  properties: {},
                  inputDefaults: {},
                  foldPins: false,
                  position: { x: 0, y: 0 },
                },
                [callId]: {
                  id: callId,
                  name: "Identity",
                  schema: {
                    package: GraphFunction.packageId,
                    schema: GraphFunction.CallSchemaId,
                  },
                  properties: { function: functionId },
                  inputDefaults: { [value.id]: "cloud" },
                  foldPins: false,
                  position: { x: 300, y: 0 },
                },
              },
              connections: [
                {
                  id: ConnectionId.make("tick-call"),
                  outNodeId: tickId,
                  outIo: OutputRef.port(GraphFunction.ExecutionIoId),
                  inNodeId: callId,
                  inIoId: GraphFunction.ExecutionIoId,
                },
              ],
            },
          },
        },
        functions: { [functionId]: fn },
      };
      const rendered: RenderedProject.Model = {
        ...Project.empty(),
        graphs: {
          [functionId]: {
            ...fn.canvas,
            nodes: {},
            schemas: {},
          },
        },
        functions: { [functionId]: fn },
      };
      const encodedProject = Schema.encodeUnknownSync(Project.Model)(project);
      const encodedSnapshot = Schema.encodeUnknownSync(RenderedProject.Model)(rendered);
      const deployed = Schema.decodeUnknownSync(Project.Model)(
        JSON.parse(JSON.stringify(encodedProject)),
      );
      const snapshot = Schema.decodeUnknownSync(RenderedProject.Model)(
        JSON.parse(JSON.stringify(encodedSnapshot)),
      );
      assert.property(snapshot.graphs, functionId);
      const steps = new Map<string, Executor.NodeExecutionResult>();
      const executor = yield* ProjectExecutor.make(deployed, {
        modules: ExecutorModules.registry,
        executionDriver: {
          executeNode: (key, effect) =>
            effect.pipe(
              Effect.tap((result) => Effect.sync(() => void steps.set(key.nodeId, result))),
            ),
        },
      });
      yield* ExecutorModules.registry.handle(executor, "util", { _tag: "TickEvent", tick: 1 });
      assert.deepStrictEqual(steps.get(GraphFunction.InputBoundaryNodeId)?.outputs, [
        { outputId: value.id, value: "cloud" },
      ]);
      assert.isTrue(steps.has(GraphFunction.OutputBoundaryNodeId));
    }),
  );
});
