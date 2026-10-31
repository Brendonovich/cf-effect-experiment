declare module "*.css" {}
declare module "*.png" {
  const url: string;
  export default url;
}

declare module "virtual:macrograph-module-settings" {
  import type { ClientSettings } from "@macrograph/module";
  import type { JSX } from "@solidjs/web";

  const settings: ReadonlyArray<ClientSettings.Descriptor<JSX.Element>>;
  export default settings;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly DEV: boolean;
  /** The macrograph.app OAuth issuer to sign in with, for testing against other stages. */
  readonly VITE_MACROGRAPH_ISSUER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
