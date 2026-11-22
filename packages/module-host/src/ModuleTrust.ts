import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import type { ModuleId } from "@macrograph/module/ModuleId";

import { Context, Effect, Layer, Option } from "effect";

export interface Input {
  readonly id: ModuleId.Id;
  readonly source: ModuleCatalog.SourceKind;
  readonly version: string;
  readonly root: Option.Option<string>;
}

export interface Status {
  readonly trust: Option.Option<ModuleCatalog.Trust>;
  readonly revoked: boolean;
  readonly updateAvailable: boolean;
}

export const unknown: Status = { trust: Option.none(), revoked: false, updateAvailable: false };

/**
 * Trust and registry flags for a module copy. The installer owns install records and registry
 * checks, so it provides this; the registry asks on load and on `refreshTrust`.
 */
export class Service extends Context.Service<
  Service,
  { readonly lookup: (input: Input) => Effect.Effect<Status> }
>()("@macrograph/module-host/ModuleTrust") {}

/** For hosts without an installer: no trust records, nothing revoked. */
export const none = Layer.succeed(Service, { lookup: () => Effect.succeed(unknown) });

export * as ModuleTrust from "./ModuleTrust.ts";
