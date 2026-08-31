import type { Package } from "@macrograph/core";
import { DataType } from "@macrograph/plugin/DataType";

import type { GraphPort } from "./GraphNode";

export type PortDirection = "input" | "output";

export interface PortEndpoint {
  readonly nodeId: string;
  readonly direction: PortDirection;
  readonly port: GraphPort;
  readonly position: { readonly x: number; readonly y: number };
  readonly occupied?: boolean;
}

export const dataTypesEqual = (
  left: Extract<GraphPort, { readonly kind: "data" }>["type"],
  right: Extract<GraphPort, { readonly kind: "data" }>["type"],
): boolean => {
  return DataType.equals(left, right);
};

export const portsCompatible = (left: GraphPort, right: GraphPort): boolean =>
  left.kind === "execution" && right.kind === "execution"
    ? true
    : left.kind === "data" && right.kind === "data" && dataTypesEqual(left.type, right.type);

export const visiblePorts = (
  ports: ReadonlyArray<GraphPort>,
  folded: boolean,
  connectedIds: ReadonlySet<string>,
): ReadonlyArray<GraphPort> =>
  folded ? ports.filter((port) => connectedIds.has(port.id)) : ports;

export const foldSelectedPins = (states: ReadonlyArray<boolean>): boolean =>
  states.some((folded) => !folded);

export const isCompatibleTarget = (source: PortEndpoint, target: PortEndpoint): boolean =>
  source.nodeId !== target.nodeId &&
  source.direction !== target.direction &&
  target.occupied !== true &&
  portsCompatible(source.port, target.port);

export const findSnapTarget = (
  source: PortEndpoint,
  targets: ReadonlyArray<PortEndpoint>,
  pointer: { readonly x: number; readonly y: number },
  maxDistance: number,
): PortEndpoint | undefined => {
  let nearest: { readonly endpoint: PortEndpoint; readonly distance: number } | undefined;
  for (const target of targets) {
    if (!isCompatibleTarget(source, target)) continue;
    const distance = Math.hypot(target.position.x - pointer.x, target.position.y - pointer.y);
    if (distance <= maxDistance && (nearest === undefined || distance < nearest.distance)) {
      nearest = { endpoint: target, distance };
    }
  }
  return nearest?.endpoint;
};

export const compatibleSchemaPorts = (
  schema: Package.SchemaModel,
  source: Pick<PortEndpoint, "direction" | "port">,
): ReadonlyArray<GraphPort> => {
  const ports: ReadonlyArray<GraphPort> =
    source.direction === "output"
      ? [
          ...schema.executionInputs.map((port) => ({
            id: port.id,
            ...(port.name === undefined ? {} : { name: port.name }),
            kind: "execution" as const,
          })),
          ...schema.dataInputs.map((port) => ({
            id: port.id,
            ...(port.name === undefined ? {} : { name: port.name }),
            type: port.type,
            kind: "data" as const,
          })),
        ]
      : [
          ...schema.executionOutputs.map((port) => ({
            id: port.id,
            ...(port.name === undefined ? {} : { name: port.name }),
            kind: "execution" as const,
          })),
          ...schema.dataOutputs.map((port) => ({
            id: port.id,
            ...(port.name === undefined ? {} : { name: port.name }),
            type: port.type,
            kind: "data" as const,
          })),
        ];
  return ports.filter((port) => portsCompatible(source.port, port));
};
