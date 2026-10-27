declare module "*.css" {}

declare module "virtual:macrograph-module-settings" {
  import type { ModuleSettingsEntry } from "@macrograph/editor-ui";

  const settings: ReadonlyArray<ModuleSettingsEntry>;
  export default settings;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
