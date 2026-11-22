import { CustomTypes, Function as GraphFunction, Queue } from "@macrograph/core";
import { ModuleId } from "@macrograph/module";

const referenceOrigin = "https://macrograph.app";

/** Built-in packages under official ids that ship with the editor rather than as modules. */
const corePackages = new Set<string>([
  CustomTypes.packageId,
  GraphFunction.packageId,
  Queue.packageId,
]);

/** A schema's page in the website's module reference, which covers the official registry. */
export const referenceUrl = (
  packageId: string | undefined,
  schema: { readonly id: string; readonly internal?: boolean | undefined },
): string | undefined => {
  if (packageId === undefined || schema.internal === true || corePackages.has(packageId))
    return undefined;
  if (!ModuleId.is(packageId) || !ModuleId.isOfficial(packageId)) return undefined;
  return `${referenceOrigin}/modules/${ModuleId.toDisplay(packageId)}/${encodeURIComponent(schema.id)}`;
};
