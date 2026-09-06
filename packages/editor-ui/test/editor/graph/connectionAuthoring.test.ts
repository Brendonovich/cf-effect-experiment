import { IoId, PackageId, SchemaId, type Package } from "@macrograph/core";
import { describe, expect, it } from "vitest";

import {
  findSnapTarget,
  foldSelectedPins,
  portsCompatible,
  singleCompatibleSchema,
  visiblePorts,
  type PortEndpoint,
} from "../../../src/editor/graph/connectionAuthoring";

const stringPort = { kind: "data", id: "value", type: { _tag: "String" } } as const;
const intPort = { kind: "data", id: "value", type: { _tag: "Int" } } as const;

describe("connection authoring", () => {
  it("counts compatible schemas, not pins, across the available packages", () => {
    const schema: Package.SchemaModel = {
      id: SchemaId.make("target"),
      name: "Target",
      type: "exec",
      properties: [],
      dataInputs: [
        { id: IoId.make("a"), type: { _tag: "String" } },
        { id: IoId.make("b"), type: { _tag: "String" } },
      ],
      dataOutputs: [{ id: IoId.make("value"), type: { _tag: "String" } }],
      executionInputs: [],
      executionOutputs: [],
    };
    const pkg: Package.Model = {
      id: PackageId.make("pkg"),
      name: "Package",
      resources: [],
      schemas: [schema],
    };
    const source = { direction: "output" as const, port: stringPort };
    expect(singleCompatibleSchema([], source)).toBeUndefined();
    expect(singleCompatibleSchema([pkg], { ...source, port: intPort })).toBeUndefined();
    expect(singleCompatibleSchema([pkg], source)).toEqual({
      ref: { package: "pkg", schema: "target" },
      name: "Target",
    });
    expect(singleCompatibleSchema([pkg], { direction: "input", port: stringPort })).toEqual({
      ref: { package: "pkg", schema: "target" },
      name: "Target",
    });
    expect(
      singleCompatibleSchema([pkg, { ...pkg, id: PackageId.make("other") }], source),
    ).toBeUndefined();
    expect(
      singleCompatibleSchema([{ ...pkg, schemas: [{ ...schema, internal: true }] }], source),
    ).toBeUndefined();
    expect(
      singleCompatibleSchema(
        [
          {
            ...pkg,
            schemas: [schema, { ...schema, id: SchemaId.make("internal"), internal: true }],
          },
        ],
        source,
      )?.ref.schema,
    ).toBe("target");
  });
  it("uses nominal identity inside custom List and Option ports", () => {
    const port = (id: string) => ({
      kind: "data" as const,
      id: "value",
      type: {
        _tag: "List" as const,
        item: { _tag: "Option" as const, inner: { _tag: "Custom" as const, id } },
      },
    });
    expect(portsCompatible(port("a"), port("a"))).toBe(true);
    expect(portsCompatible(port("a"), port("b"))).toBe(false);
  });
  it("matches execution and structurally equal data ports only", () => {
    expect(portsCompatible(stringPort, { ...stringPort, id: "input" })).toBe(true);
    expect(portsCompatible(stringPort, intPort)).toBe(false);
    expect(
      portsCompatible(
        { kind: "data", id: "list", type: { _tag: "List", item: { _tag: "String" } } },
        { kind: "data", id: "list-in", type: { _tag: "List", item: { _tag: "String" } } },
      ),
    ).toBe(true);
  });

  it("snaps to the nearest compatible unoccupied opposite pin", () => {
    const source: PortEndpoint = {
      nodeId: "source",
      direction: "output",
      port: stringPort,
      position: { x: 0, y: 0 },
    };
    const target = findSnapTarget(
      source,
      [
        {
          nodeId: "occupied",
          direction: "input",
          port: stringPort,
          position: { x: 9, y: 0 },
          occupied: true,
        },
        {
          nodeId: "wrong-type",
          direction: "input",
          port: intPort,
          position: { x: 5, y: 0 },
        },
        {
          nodeId: "target",
          direction: "input",
          port: stringPort,
          position: { x: 12, y: 0 },
        },
      ],
      { x: 0, y: 0 },
      20,
    );
    expect(target?.nodeId).toBe("target");
  });

  it("keeps connected pins visible when a node is folded", () => {
    const ports = [stringPort, { ...intPort, id: "count" }];
    expect(visiblePorts(ports, true, new Set(["count"]))).toEqual([ports[1]]);
    expect(visiblePorts(ports, false, new Set())).toEqual(ports);
  });

  it("folds a mixed selection together and expands an entirely folded selection", () => {
    expect(foldSelectedPins([true, false, true])).toBe(true);
    expect(foldSelectedPins([true, true])).toBe(false);
  });
});
