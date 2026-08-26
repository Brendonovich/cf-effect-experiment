import { type Graph, type NodeIO, type RenderedGraph } from "@macrograph/core";
import * as stylex from "@stylexjs/stylex";
import { For, createMemo, createSignal, type Component } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { GraphNode } from "./GraphNode.tsx";
import {
  connectedPortIds,
  connectionPath,
  graphConnections,
  wireColor,
} from "./graphPresentation";
import { zoomOriginAt } from "../workspace/workspace";

interface SnapshotGraphCanvasProps {
  readonly graph: Graph.Model | RenderedGraph.Model;
}

const noop = () => {};
const noSuggestions = async (): Promise<ReadonlyArray<string>> => [];
const isRenderedNode = (
  node: Graph.Model["nodes"][string] | RenderedGraph.Node,
): node is RenderedGraph.Node => "io" in node;
const isRenderedGraph = (
  graph: Graph.Model | RenderedGraph.Model,
): graph is RenderedGraph.Model => "schemas" in graph;

export const SnapshotGraphCanvas: Component<SnapshotGraphCanvasProps> = (props) => {
  const initialOrigin = createMemo(() => {
    const nodes = Object.values(props.graph.nodes);
    return nodes.length === 0
      ? { x: -80, y: -80 }
      : {
          x: Math.min(...nodes.map((node) => node.position.x)) - 80,
          y: Math.min(...nodes.map((node) => node.position.y)) - 80,
        };
  });
  const [offset, setOffset] = createSignal({ x: 0, y: 0 });
  const [scale, setScale] = createSignal(1);
  const origin = createMemo(() => ({
    x: initialOrigin().x + offset().x,
    y: initialOrigin().y + offset().y,
  }));
  const nodeIO = createMemo(() => {
    const result = new Map<string, NodeIO>();
    for (const node of Object.values(props.graph.nodes)) {
      if (isRenderedNode(node)) {
        result.set(node.id, node.io);
        continue;
      }
      result.set(node.id, {
        dataInputs: [],
        dataOutputs: [],
        executionInputs: props.graph.connections
          .filter((connection) => connection.inNodeId === node.id)
          .filter(
            (connection, index, connections) =>
              connections.findIndex((candidate) => candidate.inIoId === connection.inIoId) === index,
          )
          .map((connection) => ({ id: connection.inIoId })),
        executionOutputs: props.graph.connections
          .filter((connection) => connection.outNodeId === node.id)
          .filter(
            (connection, index, connections) =>
              connections.findIndex((candidate) => candidate.outIoId === connection.outIoId) ===
              index,
          )
          .map((connection) => ({ id: connection.outIoId })),
      });
    }
    return result;
  });
  const schemaForNode = (node: Graph.Model["nodes"][string] | RenderedGraph.Node) =>
    isRenderedGraph(props.graph)
      ? props.graph.schemas[node.schema.package]?.[node.schema.schema]
      : undefined;
  const ioForNode = (nodeId: string) => nodeIO().get(nodeId);
  const edges = createMemo(() => graphConnections(props.graph, ioForNode));

  return (
    <div
      sx={styles.canvas}
      style={{
        "background-position": `${-origin().x * scale()}px ${-origin().y * scale()}px`,
        "background-size": `${32 * scale()}px ${32 * scale()}px`,
      }}
      onWheel={(event) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const bounds = event.currentTarget.getBoundingClientRect();
          const previous = scale();
          const next = Math.min(2, Math.max(0.25, previous - event.deltaY / 500));
          const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
          setScale(next);
          setOffset((current) => zoomOriginAt(current, previous, next, pointer));
          return;
        }
        setOffset((current) => ({
          x: current.x + event.deltaX / scale(),
          y: current.y + event.deltaY / scale(),
        }));
      }}
    >
      <div sx={styles.readOnly}>Read only</div>
      <div
        sx={styles.layer}
        style={{ transform: `scale(${scale()}) translate(${-origin().x}px, ${-origin().y}px)` }}
      >
        <svg sx={styles.wires} aria-hidden="true">
          <For each={edges()}>
            {(edge) => (
              <path
                d={connectionPath(edge.from, edge.to)}
                fill="none"
                stroke={wireColor(edge.type)}
                stroke-width="2"
                opacity="0.75"
              />
            )}
          </For>
        </svg>
        <For each={Object.values(props.graph.nodes)}>
          {(node) => (
            <GraphNode
              node={node}
              schema={schemaForNode(node)}
              io={ioForNode(node.id)}
              onSelect={noop}
              onDragStart={noop}
              onPortPointerDown={noop}
              onDisconnect={noop}
              onContextMenu={noop}
              onExpand={noop}
              connectedInputIds={connectedPortIds(props.graph, node.id, "input")}
              connectedOutputIds={connectedPortIds(props.graph, node.id, "output")}
              onSetInputDefault={noop}
              onClearInputDefault={noop}
              onGetSuggestions={noSuggestions}
            />
          )}
        </For>
      </div>
    </div>
  );
};

const styles = stylex.create({
  canvas: {
    position: "relative",
    minHeight: 0,
    flex: 1,
    overflow: "hidden",
    backgroundColor: colors.gray2,
    backgroundImage: `radial-gradient(circle, ${colors.gray6} 1px, transparent 1px)`,
  },
  layer: {
    pointerEvents: "none",
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    transformOrigin: "top left",
  },
  wires: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    overflow: "visible",
  },
  readOnly: {
    pointerEvents: "none",
    position: "absolute",
    right: 8,
    bottom: 8,
    zIndex: 20,
    borderColor: colors.gray6,
    borderRadius: 9999,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: "color-mix(in srgb, var(--gray-2) 90%, transparent)",
    paddingBlock: 4,
    paddingInline: 10,
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
    fontSize: 11,
    fontWeight: 500,
    color: colors.gray10,
  },
});
