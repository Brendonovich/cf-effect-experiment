import { CustomTypes, Function as GraphFunction, Queue, defaultPackage } from "@macrograph/core";
import { ModuleId } from "@macrograph/module";

const referenceOrigin = "https://macrograph.app";

/** Packages built into the editor rather than published, which the website doesn't document. */
const corePackages = new Set<string>([
  defaultPackage.id,
  CustomTypes.packageId,
  GraphFunction.packageId,
  Queue.packageId,
  "$macrograph",
]);

/**
 * A schema's page in the website's package reference, which covers the official registry. Modules
 * loaded without a registry id are built-ins, published by `macrograph` under their module id.
 */
export const referenceUrl = (
  packageId: string | undefined,
  schema: { readonly id: string; readonly internal?: boolean | undefined },
): string | undefined => {
  if (packageId === undefined || schema.internal === true || corePackages.has(packageId))
    return undefined;
  const name = ModuleId.is(packageId)
    ? ModuleId.isOfficial(packageId)
      ? ModuleId.toDisplay(packageId)
      : undefined
    : ModuleId.isSegment(packageId)
      ? `macrograph/${packageId}`
      : undefined;
  return name === undefined
    ? undefined
    : `${referenceOrigin}/docs/${name}/${encodeURIComponent(schema.id)}`;
};
