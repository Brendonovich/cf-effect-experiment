import { hostname } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const normalizeBasePath = (value: string | undefined): string => {
  if (value === undefined || value === "" || value === "/") return "";
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\") ||
    /%2f|%5c/i.test(value)
  )
    throw new Error("MACROGRAPH_BASE_PATH must be an absolute URL path");
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error("MACROGRAPH_BASE_PATH must be a valid URL path");
  }
  if (decoded.split("/").some((segment) => segment === "." || segment === ".."))
    throw new Error("MACROGRAPH_BASE_PATH cannot contain dot segments");
  return value.replace(/\/+$/, "");
};

export const normalizePublicOrigin = (value: string): string => {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("MACROGRAPH_PUBLIC_ORIGIN must be an HTTP(S) origin without a path");
  return url.origin;
};

const numberFromEnv = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535)
    throw new Error("PORT must be an integer between 0 and 65535");
  return parsed;
};

const optionalEnv = (value: string | undefined) =>
  value === undefined || value.trim() === "" ? undefined : value;

/** An OTLP/HTTP trace destination: where to POST spans and with which headers. */
export interface OtlpTraceDestination {
  readonly url: string;
  readonly headers: Record<string, string>;
}

const parseOtlpUrl = (value: string, label: string): URL => {
  const url = URL.parse(value.trim());
  if (
    url === null ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  )
    throw new Error(`${label} must be an HTTP(S) URL without credentials or a fragment`);
  return url;
};

/** Appends `/v1/traces` to a collector base URL, preserving full trace URLs. */
const otlpTracesUrl = (base: URL): string => {
  const path = base.pathname.replace(/\/+$/, "");
  const url = new URL(base.href);
  url.pathname = path.endsWith("/v1/traces") ? path : `${path}/v1/traces`;
  return url.href;
};

const parseOtlpHeaders = (value: string | undefined): Record<string, string> => {
  const headers = new Headers();
  for (const entry of value?.split(",") ?? []) {
    const separator = entry.indexOf("=");
    if (separator <= 0) throw new Error("OTLP headers must be comma-separated name=value pairs");
    const decoded = decodeURIComponent(entry.slice(separator + 1).trim());
    const name = entry.slice(0, separator).trim();
    if (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(name) || !/^[\t\x20-\x7e\x80-\xff]*$/.test(decoded))
      throw new Error("OTLP headers must contain valid HTTP header names and values");
    headers.set(name, decoded);
  }
  return Object.fromEntries(headers);
};

/** Axiom authenticates with a bearer token and routes by dataset header. */
const axiomHeaders = (token: string, dataset: string): Record<string, string> => {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);
  headers.set("x-axiom-dataset", dataset);
  return Object.fromEntries(headers);
};

export const makeServerConfig = (env: NodeJS.ProcessEnv) => {
  const basePath = normalizeBasePath(env.MACROGRAPH_BASE_PATH);
  const port = numberFromEnv(env.PORT, 3001);
  const dataDirectory = resolve(env.MACROGRAPH_DATA_DIR ?? ".");
  const publicOrigin = normalizePublicOrigin(
    env.MACROGRAPH_PUBLIC_ORIGIN ?? `http://localhost:${port}`,
  );
  const tracesEndpoint = optionalEnv(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  const collectorEndpoint = optionalEnv(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const otlpEndpoint =
    tracesEndpoint !== undefined
      ? parseOtlpUrl(tracesEndpoint, "OTLP endpoint").href
      : collectorEndpoint !== undefined
        ? otlpTracesUrl(parseOtlpUrl(collectorEndpoint, "OTLP endpoint"))
        : undefined;
  const otlpHeaders =
    otlpEndpoint === undefined
      ? {}
      : parseOtlpHeaders(
          optionalEnv(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS) ??
            optionalEnv(env.OTEL_EXPORTER_OTLP_HEADERS),
        );

  const axiomToken = optionalEnv(env.AXIOM_TOKEN);
  const otlpDestinations: Array<OtlpTraceDestination> = [];
  if (otlpEndpoint !== undefined)
    otlpDestinations.push({ url: otlpEndpoint, headers: otlpHeaders });
  if (axiomToken !== undefined) {
    const dataset = optionalEnv(env.AXIOM_DATASET)?.trim() ?? "macrograph-traces";
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(dataset))
      throw new Error("AXIOM_DATASET must be an Axiom dataset name");
    otlpDestinations.push({
      url: otlpTracesUrl(
        parseOtlpUrl(
          optionalEnv(env.AXIOM_OTLP_ENDPOINT) ?? "https://api.axiom.co",
          "AXIOM_OTLP_ENDPOINT",
        ),
      ),
      headers: axiomHeaders(axiomToken, dataset),
    });
  }
  return {
    basePath,
    port,
    host: env.HOST ?? "0.0.0.0",
    /** Set by the Vite dev server, which owns the public port and proxies to this listener. */
    behindDevProxy: env.MACROGRAPH_BEHIND_DEV_PROXY === "1",
    dataDirectory,
    databasePath: resolve(dataDirectory, "project.db"),
    cloudAuthPath: resolve(dataDirectory, "macrograph-auth.json"),
    clientAuthPath: resolve(dataDirectory, "macrograph-client-auth.json"),
    ownerPath: resolve(dataDirectory, "macrograph-owner.json"),
    apiKeysPath: resolve(dataDirectory, "macrograph-api-keys.json"),
    issuer: (optionalEnv(env.MACROGRAPH_ISSUER) ?? "https://macrograph.app").replace(/\/$/, ""),
    /** Shown when users approve this server on macrograph.app. */
    serverName:
      optionalEnv(env.MACROGRAPH_SERVER_NAME)?.trim() || `MacroGraph server on ${hostname()}`,
    adminIds: new Set(
      (optionalEnv(env.MACROGRAPH_ADMIN_IDS) ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== ""),
    ),
    assetsDirectory: resolve(
      env.MACROGRAPH_ASSETS_DIR ?? fileURLToPath(new URL("../client", import.meta.url)),
    ),
    migrationsDirectory: resolve(
      env.MACROGRAPH_MIGRATIONS_DIR ?? fileURLToPath(new URL("./migrations", import.meta.url)),
    ),
    publicOrigin,
    otlpEndpoint,
    otlpHeaders,
    otlpDestinations,
    otlpServiceName: optionalEnv(env.OTEL_SERVICE_NAME)?.trim() ?? "macrograph-server",
    browserOtlpEndpoint: optionalEnv(env.MACROGRAPH_BROWSER_OTLP_ENDPOINT),
  };
};

export * as ServerConfig from "./ServerConfig.ts";
