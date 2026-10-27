declare module "*.css" {}
declare module "*.png" {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly DEV: boolean;
  readonly VITE_MACROGRAPH_CREDENTIALS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
