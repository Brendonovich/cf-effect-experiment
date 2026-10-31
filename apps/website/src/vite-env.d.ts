/// <reference types="@solidjs/vite-plugin/virtual-solid-manifest" />
declare module "*.css" {}

declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}
declare module "*.webp" {
  const src: string;
  export default src;
}

declare module "virtual:macrograph-module-settings" {
  import type { ClientSettings } from "@macrograph/module";
  import type { JSX } from "@solidjs/web";

  const settings: ReadonlyArray<ClientSettings.Descriptor<JSX.Element>>;
  export default settings;
}

declare module "virtual:macrograph-reference" {
  import type { Package } from "@macrograph/core";
  import type { ModuleId } from "@macrograph/module";
  import type * as Registration from "@macrograph/module/Registration";

  export interface PackageSummary extends ModuleId.Parts {
    readonly id: ModuleId.Id;
    readonly displayName: string;
    readonly description?: string;
    /** The npm package that provides the module. */
    readonly source: string;
    readonly nodes: number;
    readonly resources: number;
  }

  export interface ReferenceModule {
    readonly effect: Parameters<typeof Registration.collectModule>[0];
  }

  export const packages: ReadonlyArray<PackageSummary>;
  /** Resolve to `null` for unknown ids. */
  export const loadPackage: (id: ModuleId.Id) => Promise<typeof Package.Model.Encoded | null>;
  export const loadModule: (id: ModuleId.Id) => Promise<ReferenceModule | null>;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly SSR: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
