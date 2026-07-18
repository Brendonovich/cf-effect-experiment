import type { Node } from "@macrograph/core";
import type { Component } from "solid-js";

interface GraphNodeProps {
  node: Node.Model;
  onDelete: (nodeId: string) => void;
  onDragStart: (event: MouseEvent, node: Node.Model) => void;
}

export const GraphNode: Component<GraphNodeProps> = (props) => (
  <div
    class="group absolute min-w-40 overflow-hidden rounded-lg border-2 border-black/75 bg-black/75 text-xs text-white shadow-xl select-none"
    style={{ transform: `translate(${props.node.position.x}px, ${props.node.position.y}px)` }}
  >
    <div
      class="flex h-6 cursor-grab items-center bg-neutral-600 pl-2 font-medium active:cursor-grabbing"
      onMouseDown={(event) => props.onDragStart(event, props.node)}
    >
      <span class="min-w-0 flex-1 truncate">{props.node.name}</span>
      <button
        type="button"
        class="flex h-full w-7 items-center justify-center text-white/55 opacity-0 transition hover:bg-red-700 hover:text-white group-hover:opacity-100 focus:opacity-100 focus:outline-none"
        title={`Delete ${props.node.name}`}
        aria-label={`Delete ${props.node.name}`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => props.onDelete(props.node.id)}
      >
        <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
          <path
            d="m4.25 4.25 7.5 7.5m0-7.5-7.5 7.5"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-width="1.5"
          />
        </svg>
      </button>
    </div>
    <div class="px-2 py-2 text-[11px] text-neutral-300">
      <span class="font-mono text-neutral-400">{props.node.schema.package}</span>
      <span class="px-1 text-neutral-600">/</span>
      <span class="font-mono">{props.node.schema.schema}</span>
    </div>
  </div>
);
