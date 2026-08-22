declare module "*.css" {}

interface ImportMetaEnv {
  readonly VITE_PUBLIC_RUNTIME_ORIGIN?: string;
  readonly VITE_WORKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
