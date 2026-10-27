import { ModuleCatalogSource } from "./ModuleCatalogSource";
import { ModuleRpcProtocol, type ModuleRpcProtocolFactory } from "./ModuleRpcProtocol";
import { createModuleUILoader, type ModuleUILoader } from "./ModuleUILoader";

/** What the editor needs from the host to show modules for one connection. */
export interface ConnectionModules {
  readonly catalog: ModuleCatalogSource;
  readonly rpcProtocol: ModuleRpcProtocolFactory;
}

/**
 * How a host app supplies modules to the editor. The catalog source and RPC protocol factory are
 * derived from each connection the host opens; the UI loader lives as long as the editor.
 */
export interface EditorModules<Connection> {
  readonly catalog: (connection: Connection) => ModuleCatalogSource;
  readonly loader: ModuleUILoader;
  readonly rpcProtocol: (connection: Connection) => ModuleRpcProtocolFactory;
}

/**
 * Modules bundled into the host: a catalog of the packages the connection loaded, bundled UI loaders
 * and the host's RPC protocols. Without a protocol, module settings report that RPCs are unavailable.
 */
export const bundledModules = <Connection>(
  options: {
    readonly loader?: ModuleUILoader;
    readonly rpcProtocol?: (connection: Connection) => ModuleRpcProtocolFactory;
  } = {},
): EditorModules<Connection> => ({
  catalog: () => ModuleCatalogSource.fromPackages,
  loader: options.loader ?? createModuleUILoader(),
  rpcProtocol: options.rpcProtocol ?? (() => ModuleRpcProtocol.unavailable),
});
