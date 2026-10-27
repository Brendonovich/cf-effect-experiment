declare module "*.css" {}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
