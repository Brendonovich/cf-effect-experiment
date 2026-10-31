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

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly SSR: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
