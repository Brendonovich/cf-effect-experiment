declare module "*.png" {
  const url: string;
  export default url;
}

interface ImportMeta {
  readonly hot?: {
    readonly dispose: (callback: () => void) => void;
  };
}
