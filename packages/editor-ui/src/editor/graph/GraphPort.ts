import { OutputRef, type NodeIO } from "@macrograph/core";

export type GraphPort = {
  /** Inputs use their port ID; outputs use OutputRef.key. */
  readonly id: string;
  readonly name?: string;
  readonly outputRef?: OutputRef.Model;
  readonly scopeGroup?: string;
} & (
  | { readonly kind: "execution" }
  | { readonly kind: "scope"; readonly scope: NodeIO["executionOutputs"][number]["scope"] }
  | {
      readonly kind: "data";
      readonly type: NodeIO["dataOutputs"][number]["type"];
      readonly invalid?: boolean;
    }
);

export const asOutputPort = (port: GraphPort, ref = OutputRef.port(port.id)): GraphPort => ({
  ...port,
  id: OutputRef.key(ref),
  outputRef: ref,
});
export const outputRefForPort = (port: GraphPort): OutputRef.Model =>
  port.outputRef ?? OutputRef.port(port.id);
