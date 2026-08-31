import { type Node, type NodeIO, type Package } from "@macrograph/core";
import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal, type Component } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { TextInput } from "../../ui/TextInput";
import { visiblePorts } from "./connectionAuthoring";
import {
  graphNodeInputs,
  graphNodeOutputs,
  graphNodeWidth,
  type GraphPort,
} from "./graphPresentation";

export {
  GRAPH_NODE_FIRST_IO_Y,
  GRAPH_NODE_IO_SPACING,
  graphNodeInputs,
  graphNodeOutputs,
  graphNodeWidth,
  type GraphPort,
} from "./graphPresentation";

const styles = stylex.create({
  pinTarget: {
    position: "relative",
    width: 14,
    height: 14,
    flexShrink: 0,
    "::after": {
      position: "absolute",
      inset: -8,
      content: "",
      display: { default: "block", "@media (pointer: fine)": "none" },
    },
  },
  executionPin: {
    pointerEvents: "none",
    width: "100%",
    height: "100%",
    color: "white",
    fill: { default: "transparent", ":hover": "currentColor" },
  },
  executionPinFilled: { fill: "currentColor" },
  highlightedExecutionPin: { filter: "drop-shadow(0 0 3px rgb(255 255 255 / 0.6))" },
  dataPin: {
    pointerEvents: "none",
    display: "flex",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    borderRadius: "50%",
    borderColor: "currentColor",
    borderStyle: "solid",
    borderWidth: 2.5,
    backgroundColor: "transparent",
  },
  dataPinFilled: { backgroundColor: "currentColor" },
  listPin: { borderRadius: 3 },
  optionPin: { borderWidth: 1.5 },
  optionPinFilled: { borderWidth: 2.5 },
  optionPinInner: {
    width: 8,
    height: 8,
    boxSizing: "border-box",
    borderColor: "currentColor",
    borderRadius: "50%",
    borderStyle: "solid",
    borderWidth: 1.5,
  },
  optionPinInnerFilled: { width: 4, height: 4, backgroundColor: "currentColor" },
  optionListPinInner: { borderRadius: 1 },
  stringPin: { color: "#da5697" },
  intPin: { color: "#30f3db" },
  floatPin: { color: "#00ae75" },
  boolPin: { color: "#dc2626" },
  dateTimePin: { color: "#3b82f6" },
  highlightedDataPin: { boxShadow: "0 0 0 2px rgb(255 255 255 / 0.6)" },
  defaultControls: { display: "flex", flexShrink: 0, alignItems: "center", gap: 2 },
  defaultInput: {
    width: 64,
    minWidth: 0,
    height: 20,
    borderColor: { default: "rgb(255 255 255 / 0.15)", ":focus": colors.focus },
    borderRadius: 4,
    borderStyle: "solid",
    borderWidth: 1,
    outline: "none",
    backgroundColor: "rgb(255 255 255 / 0.1)",
    paddingInline: 4,
    fontSize: 10,
    color: "white",
  },
  checkbox: { width: 14, height: 14, accentColor: colors.focus },
  node: {
    position: "absolute",
    overflow: "hidden",
    borderColor: "rgb(0 0 0 / 0.75)",
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 2,
    backgroundColor: "rgb(0 0 0 / 0.75)",
    color: "white",
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  selectedNode: { boxShadow: `0 0 0 2px ${colors.focus}` },
  smoothPosition: {
    transitionDuration: { default: "40ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    transitionProperty: "transform",
    transitionTimingFunction: "linear",
  },
  nodeHeader: { height: 22, fontWeight: 500 },
  eventHeader: { backgroundColor: colors.event },
  execHeader: { backgroundColor: colors.execution },
  pureHeader: { backgroundColor: colors.pure },
  baseHeader: { backgroundColor: colors.base },
  dragHandle: {
    display: "flex",
    width: "100%",
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    paddingInline: 7,
    textAlign: "left",
  },
  nodeBody: { display: "flex", flexDirection: "row", gap: 8, fontSize: 12 },
  portList: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 8,
    paddingBlock: 8,
    paddingInline: 6,
  },
  portRow: {
    display: "flex",
    height: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  portSide: { display: "flex", flexDirection: "row", alignItems: "center", gap: 6 },
  outputSide: { justifyContent: "flex-end" },
  expandRow: {
    display: "flex",
    width: "100%",
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  focusRing: {
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  expandButton: {
    display: "flex",
    height: 12,
    alignItems: "center",
    justifyContent: "center",
    border: 0,
    borderRadius: 4,
    backgroundColor: { default: "transparent", ":hover": "rgb(255 255 255 / 0.3)" },
    paddingInline: 4,
  },
  expandIcon: { width: 16, height: 16, flexShrink: 0 },
});

type DataType = NodeIO["dataInputs"][number]["type"];

export const formatDataType = (type: DataType): string => {
  switch (type._tag) {
    case "List":
      return `List<${formatDataType(type.item)}>`;
    case "Option":
      return `Option<${formatDataType(type.inner)}>`;
    default:
      return type._tag;
  }
};

const primaryDataType = (type: DataType): Exclude<DataType["_tag"], "List" | "Option"> =>
  type._tag === "List"
    ? primaryDataType(type.item)
    : type._tag === "Option"
      ? primaryDataType(type.inner)
      : type._tag;

const dataPinStyle = (type: DataType) => {
  switch (primaryDataType(type)) {
    case "String":
      return styles.stringPin;
    case "Int":
      return styles.intPin;
    case "Float":
      return styles.floatPin;
    case "Bool":
      return styles.boolPin;
    case "DateTime":
      return styles.dateTimePin;
  }
};

const formattedPortType = (port: GraphPort | undefined) =>
  port?.kind === "data" ? formatDataType(port.type) : undefined;

interface GraphNodeProps {
  node: Node.Model;
  schema?: Package.SchemaModel | undefined;
  io?: NodeIO | undefined;
  selected?: boolean;
  dragging?: boolean;
  positioning?: boolean;
  presenceColor?: string | undefined;
  connectionSource?:
    | {
        readonly nodeId: string;
        readonly ioId: string;
        readonly kind: GraphPort["kind"];
        readonly direction: "input" | "output";
        readonly dragging: boolean;
      }
    | undefined;
  snapTarget?:
    | {
        readonly nodeId: string;
        readonly ioId: string;
        readonly kind: GraphPort["kind"];
        readonly direction: "input" | "output";
      }
    | undefined;
  onSelect: (nodeId: string, additive: boolean) => void;
  onDragStart: (event: PointerEvent, node: Node.Model) => void;
  onPortPointerDown: (
    event: PointerEvent,
    nodeId: string,
    ioId: string,
    kind: GraphPort["kind"],
    direction: "input" | "output",
  ) => void;
  onDisconnect: (direction: "input" | "output", nodeId: string, ioId: string) => void;
  onContextMenu: (event: MouseEvent, nodeId: string) => void;
  onExpand: (nodeId: string) => void;
  connectedInputIds: ReadonlySet<string>;
  connectedOutputIds: ReadonlySet<string>;
  onSetInputDefault: (input: string, value: unknown) => void;
  onClearInputDefault: (input: string) => void;
  onGetSuggestions: (input: string) => Promise<ReadonlyArray<string>>;
}

const headerStyle = (type: Package.SchemaModel["type"] | undefined) => {
  switch (type) {
    case "event":
      return styles.eventHeader;
    case "exec":
      return styles.execHeader;
    case "pure":
      return styles.pureHeader;
    default:
      return styles.baseHeader;
  }
};

const Pin: Component<{
  direction: "input" | "output";
  port: GraphPort;
  nodeId: string;
  filled?: boolean;
  highlighted?: boolean;
  onPointerDown?: (event: PointerEvent) => void;
  onDoubleClick?: () => void;
}> = (props) => {
  const [hovered, setHovered] = createSignal(false);
  const active = () => props.filled || props.highlighted || hovered();

  return (
    <div
      sx={styles.pinTarget}
      data-io-direction={props.direction}
      data-io-kind={props.port.kind}
      data-node-id={props.nodeId}
      data-io-id={props.port.id}
      title={props.port.kind === "data" ? formatDataType(props.port.type) : "Execution"}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onPointerDown?.(event);
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onDblClick={() => props.onDoubleClick?.()}
    >
      {props.port.kind === "execution" ? (
        <svg
          viewBox="0 0 14 17.5"
          sx={[
            styles.executionPin,
            active() ? styles.executionPinFilled : null,
            props.highlighted && styles.highlightedExecutionPin,
          ]}
          aria-hidden="true"
        >
          <path
            d="M12.6667 8.53812C13.2689 9.03796 13.2689 9.96204 12.6667 10.4619L5.7983 16.1622C4.98369 16.8383 3.75 16.259 3.75 15.2003V3.79967C3.75 2.74104 4.98369 2.16171 5.79831 2.83779L12.6667 8.53812Z"
            stroke="white"
            stroke-width="1.5"
          />
        </svg>
      ) : (
        <div
          sx={[
            styles.dataPin,
            dataPinStyle(props.port.type),
            props.port.type._tag === "List" && styles.listPin,
            props.port.type._tag === "Option" && styles.optionPin,
            props.port.type._tag === "Option" && active() ? styles.optionPinFilled : null,
            props.port.type._tag !== "Option" && active() ? styles.dataPinFilled : null,
            props.highlighted && styles.highlightedDataPin,
          ]}
        >
          {props.port.type._tag === "Option" && (
            <div
              sx={[
                styles.optionPinInner,
                props.port.type.inner._tag === "List" && styles.optionListPinInner,
                active() ? styles.optionPinInnerFilled : null,
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
};

const DataDefaultControl: Component<{
  node: Node.Model;
  port: Extract<GraphPort, { readonly kind: "data" }>;
  pluginDefault?: () => unknown;
  suggestions: boolean;
  connected: boolean;
  onSet: (value: unknown) => void;
  onClear: () => void;
  onGetSuggestions: () => Promise<ReadonlyArray<string>>;
}> = (props) => {
  const persisted = () => Object.hasOwn(props.node.inputDefaults, props.port.id);
  const value = () =>
    persisted() ? props.node.inputDefaults[props.port.id] : props.pluginDefault?.();
  const formatValue = () => {
    const current = value();
    return typeof current === "string" || typeof current === "number" ? String(current) : "";
  };
  const [draft, setDraft] = createSignal(formatValue);
  const commitNumber = () => {
    const next = Number(draft());
    const valid =
      draft().trim() !== "" &&
      Number.isFinite(next) &&
      (props.port.type._tag !== "Int" || Number.isSafeInteger(next));
    if (valid) props.onSet(next);
    else setDraft(formatValue());
  };
  return (
    <div sx={styles.defaultControls} onPointerDown={(event) => event.stopPropagation()}>
      <Show when={!props.connected && props.port.type._tag === "String"}>
        <TextInput
          value={formatValue()}
          label={props.port.name || props.port.id}
          onChange={props.onSet}
          onGetSuggestions={props.suggestions ? props.onGetSuggestions : undefined}
        />
      </Show>
      <Show
        when={
          !props.connected && (props.port.type._tag === "Int" || props.port.type._tag === "Float")
        }
      >
        <input
          sx={styles.defaultInput}
          type="number"
          step={props.port.type._tag === "Int" ? "1" : "any"}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={commitNumber}
        />
      </Show>
      <Show when={!props.connected && props.port.type._tag === "Bool"}>
        <input
          sx={styles.checkbox}
          type="checkbox"
          checked={value() === true}
          onChange={(event) => props.onSet(event.currentTarget.checked)}
        />
      </Show>
    </div>
  );
};

export const GraphNode: Component<GraphNodeProps> = (props) => {
  const inputs = () =>
    visiblePorts(graphNodeInputs(props.io), props.node.foldPins, props.connectedInputIds);
  const outputs = () =>
    visiblePorts(graphNodeOutputs(props.io), props.node.foldPins, props.connectedOutputIds);
  const hasHiddenPins = () =>
    inputs().length !== graphNodeInputs(props.io).length ||
    outputs().length !== graphNodeOutputs(props.io).length;
  const rows = () =>
    Array.from({
      length: Math.max(inputs().length, outputs().length),
    });

  return (
    <div
      sx={[
        styles.node,
        props.selected && styles.selectedNode,
        !props.dragging && !props.positioning && styles.smoothPosition,
      ]}
      style={{
        width: `${graphNodeWidth(props.io, props.node.name)}px`,
        transform: `translate(${props.node.position.x}px, ${props.node.position.y}px)`,
        "box-shadow":
          !props.selected && props.presenceColor ? `0 0 0 2px ${props.presenceColor}` : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onContextMenu(event, props.node.id);
      }}
    >
      <div
        sx={[styles.nodeHeader, headerStyle(props.schema?.type)]}
        title={props.schema?.description}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (event.button === 0) props.onSelect(props.node.id, event.shiftKey);
        }}
      >
        <div sx={styles.dragHandle} onPointerDown={(event) => props.onDragStart(event, props.node)}>
          {props.node.name}
        </div>
      </div>
      <div sx={styles.nodeBody}>
        <div sx={styles.portList}>
          <For each={rows()}>
            {(_, index) => {
              const input = () => inputs()[index()];
              const output = () => outputs()[index()];
              const inputIsSource = () =>
                props.connectionSource?.nodeId === props.node.id &&
                props.connectionSource.ioId === input()?.id &&
                props.connectionSource.kind === input()?.kind &&
                props.connectionSource.direction === "input";
              const outputIsSource = () =>
                props.connectionSource?.nodeId === props.node.id &&
                props.connectionSource.ioId === output()?.id &&
                props.connectionSource.kind === output()?.kind &&
                props.connectionSource.direction === "output";
              return (
                <div sx={styles.portRow}>
                  <div sx={styles.portSide}>
                    {input() && (
                      <Pin
                        direction="input"
                        port={input()!}
                        nodeId={props.node.id}
                        filled={props.connectedInputIds.has(input()!.id) || inputIsSource()}
                        highlighted={
                          (inputIsSource() && props.connectionSource?.dragging === true) ||
                          (props.snapTarget?.nodeId === props.node.id &&
                            props.snapTarget.ioId === input()!.id &&
                            props.snapTarget.kind === input()!.kind &&
                            props.snapTarget.direction === "input")
                        }
                        onPointerDown={(event) =>
                          props.onPortPointerDown(
                            event,
                            props.node.id,
                            input()!.id,
                            input()!.kind,
                            "input",
                          )
                        }
                        onDoubleClick={() =>
                          props.onDisconnect("input", props.node.id, input()!.id)
                        }
                      />
                    )}
                    <span title={formattedPortType(input())}>
                      {input()?.kind === "data" && (input()?.name || input()?.id)}
                    </span>
                    <Show
                      when={
                        input()?.kind === "data" &&
                        (input() as Extract<GraphPort, { readonly kind: "data" }>)
                      }
                    >
                      {(port) => {
                        const metadata = () =>
                          props.io?.dataInputs.find((candidate) => candidate.id === port().id);
                        return (
                          <DataDefaultControl
                            node={props.node}
                            port={port()}
                            connected={props.connectedInputIds.has(port().id)}
                            pluginDefault={() => metadata()?.defaultValue}
                            suggestions={metadata()?.suggestions === true}
                            onSet={(value) => props.onSetInputDefault(port().id, value)}
                            onClear={() => props.onClearInputDefault(port().id)}
                            onGetSuggestions={() => props.onGetSuggestions(port().id)}
                          />
                        );
                      }}
                    </Show>
                  </div>
                  <div sx={[styles.portSide, styles.outputSide]}>
                    <span title={formattedPortType(output())}>
                      {output()?.kind === "data" && (output()?.name || output()?.id)}
                    </span>
                    {output() && (
                      <Pin
                        direction="output"
                        port={output()!}
                        nodeId={props.node.id}
                        filled={props.connectedOutputIds.has(output()!.id) || outputIsSource()}
                        highlighted={
                          (outputIsSource() && props.connectionSource?.dragging === true) ||
                          (props.snapTarget?.nodeId === props.node.id &&
                            props.snapTarget.ioId === output()!.id &&
                            props.snapTarget.kind === output()!.kind &&
                            props.snapTarget.direction === "output")
                        }
                        onPointerDown={(event) =>
                          props.onPortPointerDown(
                            event,
                            props.node.id,
                            output()!.id,
                            output()!.kind,
                            "output",
                          )
                        }
                        onDoubleClick={() =>
                          props.onDisconnect("output", props.node.id, output()!.id)
                        }
                      />
                    )}
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>
      {hasHiddenPins() && (
        <div sx={styles.expandRow}>
          <button
            type="button"
            title="Expand node IO"
            sx={[styles.focusRing, styles.expandButton]}
            onClick={() => props.onExpand(props.node.id)}
          >
            <IconMdiDotsHorizontal {...stylex.attrs(styles.expandIcon)} />
          </button>
        </div>
      )}
    </div>
  );
};
