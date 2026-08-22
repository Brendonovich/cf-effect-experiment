import type { Node, Package } from "@macrograph/core";

import { For, type Component } from "solid-js";

export const GRAPH_NODE_FIRST_IO_Y = 42;
export const GRAPH_NODE_IO_SPACING = 28;

export function graphNodeWidth(schema: Package.SchemaModel | undefined, name = ""): number {
  const input = Math.max(
    0,
    ...(schema?.executionInputs.map((port) => (port.name || port.id || "").length) ?? []),
  );
  const output = Math.max(
    0,
    ...(schema?.executionOutputs.map((port) => (port.name || port.id || "").length) ?? []),
  );
  return Math.max(104, Math.min(240, 38 + Math.max(name?.length ?? 0, input + output) * 6.5));
}

interface GraphNodeProps {
  node: Node.Model;
  schema?: Package.SchemaModel | undefined;
  selected?: boolean;
  folded?: boolean;
  pendingOutput?: { readonly nodeId: string; readonly ioId: string } | undefined;
  onSelect: (nodeId: string, additive: boolean) => void;
  onDragStart: (event: PointerEvent, node: Node.Model) => void;
  onExecOutputPointerDown: (event: PointerEvent, nodeId: string, ioId: string) => void;
  onDisconnect: (direction: "input" | "output", nodeId: string, ioId: string) => void;
  onContextMenu: (event: MouseEvent, nodeId: string) => void;
  onExpand: (nodeId: string) => void;
}

const headerClass = (type: Package.SchemaModel["type"] | undefined) => {
  switch (type) {
    case "event":
      return "bg-red-700";
    case "exec":
      return "bg-blue-600";
    case "pure":
      return "bg-emerald-700";
    default:
      return "bg-mg-base";
  }
};

const ExecPin: Component<{
  direction: "input" | "output";
  nodeId: string;
  ioId: string;
  connected?: boolean;
  highlighted?: boolean;
  onPointerDown?: (event: PointerEvent) => void;
  onDoubleClick?: () => void;
}> = (props) => (
  <div class="size-3.5 shrink-0">
    <svg
      viewBox="0 0 14 17.5"
      class={`h-full w-full text-white hover:fill-current ${
        props.connected || props.highlighted ? "fill-current" : "fill-transparent"
      } ${props.highlighted ? "drop-shadow-[0_0_3px_rgba(255,255,255,0.6)]" : ""}`}
      data-exec-input={props.direction === "input" ? "true" : undefined}
      data-node-id={props.nodeId}
      data-io-id={props.ioId}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onPointerDown?.(event);
      }}
      onDblClick={() => props.onDoubleClick?.()}
      aria-hidden="true"
    >
      <path
        d="M12.6667 8.53812C13.2689 9.03796 13.2689 9.96204 12.6667 10.4619L5.7983 16.1622C4.98369 16.8383 3.75 16.259 3.75 15.2003V3.79967C3.75 2.74104 4.98369 2.16171 5.79831 2.83779L12.6667 8.53812Z"
        stroke="white"
        stroke-width="1.5"
      />
    </svg>
  </div>
);

export const GraphNode: Component<GraphNodeProps> = (props) => {
  const rows = () =>
    props.folded
      ? []
      : Array.from({
          length: Math.max(
            props.schema?.executionInputs.length ?? 0,
            props.schema?.executionOutputs.length ?? 0,
          ),
        });

  return (
    <div
      class={`absolute overflow-hidden whitespace-nowrap rounded-lg border-2 border-black/75 bg-black/75 text-xs text-white ${
        props.selected ? "ring-2 ring-yellow-500" : ""
      }`}
      style={{
        width: `${graphNodeWidth(props.schema, props.node.name)}px`,
        transform: `translate(${props.node.position.x}px, ${props.node.position.y}px)`,
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        props.onSelect(props.node.id, event.shiftKey);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onContextMenu(event, props.node.id);
      }}
    >
      <div class={`h-[22px] font-medium ${headerClass(props.schema?.type)}`}>
        <div
          class="flex h-full w-full cursor-grab flex-row items-center bg-transparent px-[7px] text-left active:cursor-grabbing"
          onPointerDown={(event) => props.onDragStart(event, props.node)}
        >
          {props.node.name}
        </div>
      </div>
      <div class="flex flex-row gap-2 text-xs">
        <div class="flex flex-1 flex-col items-stretch gap-2 px-1.5 py-2">
          <For each={rows()}>
            {(_, index) => {
              const input = () => props.schema?.executionInputs[index()];
              const output = () => props.schema?.executionOutputs[index()];
              return (
                <div class="flex h-5 flex-row items-center justify-between gap-4">
                  <div class="flex min-w-0 flex-row items-center gap-1.5">
                    {input() && (
                      <ExecPin
                        direction="input"
                        nodeId={props.node.id}
                        ioId={input()!.id}
                        onDoubleClick={() =>
                          props.onDisconnect("input", props.node.id, input()!.id)
                        }
                      />
                    )}
                    <span class="truncate">{input()?.name || input()?.id}</span>
                  </div>
                  <div class="flex min-w-0 flex-row items-center justify-end gap-1.5">
                    <span class="truncate">{output()?.name || output()?.id}</span>
                    {output() && (
                      <ExecPin
                        direction="output"
                        nodeId={props.node.id}
                        ioId={output()!.id}
                        highlighted={
                          props.pendingOutput?.nodeId === props.node.id &&
                          props.pendingOutput.ioId === output()!.id
                        }
                        onPointerDown={(event) =>
                          props.onExecOutputPointerDown(event, props.node.id, output()!.id)
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
      {props.folded && (
        <div class="flex h-4 w-full items-center justify-center">
          <button
            type="button"
            title="Expand node IO"
            class="focus-ring flex h-3 items-center justify-center rounded px-1 hover:bg-gray-12/30"
            onClick={() => props.onExpand(props.node.id)}
          >
            <IconMdiDotsHorizontal class="size-4 shrink-0" />
          </button>
        </div>
      )}
    </div>
  );
};
