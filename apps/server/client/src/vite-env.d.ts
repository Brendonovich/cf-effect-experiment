declare module "*.css" {}

declare module "virtual:macrograph-plugin-settings" {
  import type { PluginSettingsDescriptor } from "@macrograph/editor-ui";

  const settings: ReadonlyArray<PluginSettingsDescriptor>;
  export default settings;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
