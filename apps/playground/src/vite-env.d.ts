declare module "*.css" {}
declare module "*.png" {
  const url: string;
  export default url;
}

declare module "virtual:macrograph-plugin-settings" {
  import type { JSX } from "@solidjs/web";
  import type { ClientSettings } from "@macrograph/plugin";

  const settings: ReadonlyArray<ClientSettings.Descriptor<JSX.Element>>;
  export default settings;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly DEV: boolean;
  readonly VITE_MACROGRAPH_CREDENTIALS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
