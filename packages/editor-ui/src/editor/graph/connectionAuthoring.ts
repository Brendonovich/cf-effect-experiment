import type { Package, SchemaRef } from "@macrograph/core";

import { BuiltinAuthoring, type SchemaAuthoring } from "@macrograph/core";
import { DataType } from "@macrograph/module/DataType";
import { scopesCompatible } from "@macrograph/module/Registration";

import type { GraphPort } from "./GraphNode";

import { asOutputPort } from "./GraphPort";

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
  return DataType.compatible(left, right);
};

export const portsCompatible = (left: GraphPort, right: GraphPort): boolean =>
  (left.kind === "data" && left.invalid) || (right.kind === "data" && right.invalid)
    ? false
    : left.kind === "execution" && right.kind === "execution"
      ? true
      : left.kind === "scope" && right.kind === "scope"
        ? left.scope === null
          ? scopesCompatible(right.scope, left.scope)
          : scopesCompatible(left.scope, right.scope)
        : left.kind === "data" && right.kind === "data" && dataTypesEqual(left.type, right.type);

export const visiblePorts = (
  ports: ReadonlyArray<GraphPort>,
  folded: boolean,
  connectedIds: ReadonlySet<string>,
): ReadonlyArray<GraphPort> =>
  folded
    ? ports.filter(
        (port) =>
          connectedIds.has(port.id) ||
          (port.kind === "data" && port.invalid) ||
          (port.outputRef?._tag === "ScopeExec" &&
            ports.some(
              (field) =>
                field.scopeGroup === port.scopeGroup &&
                (connectedIds.has(field.id) || (field.kind === "data" && field.invalid)),
            )),
      )
    : ports;

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
  packageId?: string,
  definitions?: DataType.Definitions,
  authoring: SchemaAuthoring.Registry = BuiltinAuthoring.registry,
): ReadonlyArray<GraphPort> => {
  if (schema.internal === true) return [];
  const behavior =
    packageId === undefined ? undefined : authoring.get({ package: packageId, schema: schema.id });
  const execution =
    source.direction === "output" ? schema.executionInputs : schema.executionOutputs;
  const data = source.direction === "output" ? schema.dataInputs : schema.dataOutputs;
  const ports: ReadonlyArray<GraphPort> = [
    ...execution.map((port) => ({
      id: port.id,
      ...(port.name === undefined ? {} : { name: port.name }),
      ...(port.scope === undefined
        ? { kind: "execution" as const }
        : { kind: "scope" as const, scope: port.scope }),
    })),
    ...data.map((port) => ({
      id: port.id,
      type: port.type,
      kind: "data" as const,
      ...(port.name === undefined ? {} : { name: port.name }),
    })),
  ];
  return (source.direction === "input" ? ports.map((port) => asOutputPort(port)) : ports).filter(
    (port) =>
      portsCompatible(source.port, port) &&
      (source.direction !== "output" ||
        source.port.kind !== "data" ||
        behavior?.acceptsInput?.(port.id, source.port.type, definitions) !== false),
  );
};

export const singleCompatibleSchema = (
  packages: ReadonlyArray<Package.Model>,
  source: Pick<PortEndpoint, "direction" | "port">,
  definitions?: DataType.Definitions,
  authoring: SchemaAuthoring.Registry = BuiltinAuthoring.registry,
): { readonly ref: SchemaRef; readonly name: string } | undefined => {
  let match: { ref: SchemaRef; name: string } | undefined;
  for (const pkg of packages) {
    for (const schema of pkg.schemas) {
      if (compatibleSchemaPorts(schema, source, pkg.id, definitions, authoring).length === 0)
        continue;
      if (match !== undefined) return undefined;
      match = { ref: { package: pkg.id, schema: schema.id }, name: schema.name };
    }
  }
  return match;
};
