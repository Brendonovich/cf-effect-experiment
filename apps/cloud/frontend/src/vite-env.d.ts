declare module "*.css" {}

declare module "virtual:macrograph-module-settings" {
  import type { ModuleSettingsDescriptor } from "@macrograph/editor-ui";

  const settings: ReadonlyArray<ModuleSettingsDescriptor>;
  export default settings;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_AXIOM_ORG_ID?: string;
  readonly VITE_AXIOM_TRACE_DATASET?: string;
  readonly VITE_PUBLIC_WORKER_ORIGIN?: string;
  readonly VITE_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
