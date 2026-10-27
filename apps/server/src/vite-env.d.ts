/// <reference types="vite/client" />

declare module "virtual:macrograph-dev-modules" {
  import type { DevModules } from "./DevModules.ts";

  const sources: ReadonlyArray<DevModules.Source>;
  export default sources;
}
