import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import { realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const reservedPaths = [
  "/api",
  "/health",
  "/plugin",
  "/rpc",
  "/rpc-ws",
];

const decodePath = (url: string) => {
  const pathname = url.split("?", 1)[0] ?? "";
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
};

export const isUnsafePath = (url: string) => {
  const decoded = decodePath(url);
  if (decoded === undefined) return true;
  const segments = decoded.split("/");
  return (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    segments.some((segment) => segment === ".." || segment.startsWith("."))
  );
};

export const isInsideStaticRoot = (root: string, url: string) => {
  const decoded = decodePath(url);
  if (decoded === undefined) return false;
  const realRoot = realpathSync(root);
  const requestedPath = resolve(realRoot, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  const isInside = (path: string) => path === realRoot || path.startsWith(`${realRoot}${sep}`);
  const isIndexInside = (directory: string) => {
    try {
      return isInside(realpathSync(join(directory, "index.html")));
    } catch {
      return false;
    }
  };
  try {
    const realRequestedPath = realpathSync(requestedPath);
    if (!isInside(realRequestedPath)) return false;
    return statSync(realRequestedPath).isDirectory() ? isIndexInside(realRequestedPath) : true;
  } catch (error) {
    const missing =
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR");
    return missing && isIndexInside(realRoot);
  }
};

const isReservedPath = (url: string) => {
  const path = decodePath(url);
  return (
    path !== undefined &&
    reservedPaths.some((reserved) => path === reserved || path.startsWith(`${reserved}/`))
  );
};

export const layer = (options: {
  readonly root: string;
  readonly basePath: string;
  readonly publicOrigin: string;
  readonly otlpEndpoint?: string | undefined;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const assets = yield* HttpStaticServer.make({
        root: options.root,
        cacheControl: "public, max-age=31536000, immutable",
      });
      const application = yield* HttpStaticServer.make({
        root: options.root,
        spa: true,
        cacheControl: "no-cache",
      });
      const router = (yield* HttpRouter.HttpRouter).prefixed(options.basePath);
      const websocketOrigin = new URL(options.publicOrigin);
      websocketOrigin.protocol = websocketOrigin.protocol === "https:" ? "wss:" : "ws:";
      const connectSources = ["'self'", websocketOrigin.origin];
      if (options.otlpEndpoint !== undefined) {
        try {
          connectSources.push(new URL(options.otlpEndpoint).origin);
        } catch {
          // Invalid tracing configuration is ignored by both the browser and CSP.
        }
      }
      const csp = [
        "default-src 'self'",
        "base-uri 'self'",
        `connect-src ${connectSources.join(" ")}`,
        "img-src 'self' data: https://gravatar.com",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
      ].join("; ");

      yield* router.add(
        "GET",
        "/*",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const path = request.url.split("?", 1)[0] ?? "/";
          if (isUnsafePath(request.url))
            return HttpServerResponse.text("Invalid path", { status: 400 });
          if (isReservedPath(request.url))
            return HttpServerResponse.text("Not found", { status: 404 });
          if (!isInsideStaticRoot(options.root, path))
            return HttpServerResponse.text("Not found", { status: 404 });
          const response = yield* path.startsWith("/assets/") ? assets : application;
          return HttpServerResponse.setHeader(response, "content-security-policy", csp);
        }),
      );
    }),
  );

export * as StaticRoutes from "./StaticRoutes.ts";
