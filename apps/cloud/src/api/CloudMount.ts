import { cloudPathPrefix } from "./HttpOrigin.ts";

/** Path prefixes CloudWorker's application handles; everything else is the web app's assets. */
const applicationPaths = ["/api/", "/oauth/", "/.well-known/"];

export type Resolved =
  | { readonly _tag: "Redirect"; readonly location: string }
  | {
      readonly _tag: "Application" | "Assets";
      /** The path within Cloud, without the mount. */
      readonly path: string;
      /** Whether the request arrived under the `/cloud` mount. */
      readonly mounted: boolean;
    };

/**
 * Maps a request path to what CloudWorker serves. Worker Routes deliver `/cloud/*` with the mount
 * still in the path, along with the RFC 8414/9728 well-known documents for an issuer and resource
 * under `/cloud`, which clients look up at the origin root.
 */
export const resolve = (pathname: string, search: string): Resolved => {
  if (pathname === cloudPathPrefix)
    return { _tag: "Redirect", location: `${cloudPathPrefix}/${search}` };
  let path = pathname;
  let mounted = false;
  if (pathname.startsWith(`${cloudPathPrefix}/`)) {
    path = pathname.slice(cloudPathPrefix.length);
    mounted = true;
  } else if (pathname === `/.well-known/oauth-authorization-server${cloudPathPrefix}`) {
    path = "/.well-known/oauth-authorization-server";
    mounted = true;
  } else if (pathname.startsWith(`/.well-known/oauth-protected-resource${cloudPathPrefix}/`)) {
    path = `/.well-known/oauth-protected-resource/${pathname.slice(`/.well-known/oauth-protected-resource${cloudPathPrefix}/`.length)}`;
    mounted = true;
  }
  const application =
    path === "/rpc" ||
    path.startsWith("/rpc/") ||
    applicationPaths.some((prefix) => path.startsWith(prefix));
  return { _tag: application ? "Application" : "Assets", path, mounted };
};

/** The Worker Route patterns CloudWorker claims on a public hostname. */
export const routePatterns = (hostname: string) => [
  `${hostname}${cloudPathPrefix}`,
  `${hostname}${cloudPathPrefix}/*`,
  `${hostname}/.well-known/oauth-authorization-server${cloudPathPrefix}`,
  `${hostname}/.well-known/oauth-protected-resource${cloudPathPrefix}/*`,
];
