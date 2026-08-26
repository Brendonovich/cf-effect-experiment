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

export const makeServerConfig = (env: NodeJS.ProcessEnv) => {
  const basePath = normalizeBasePath(env.MACROGRAPH_BASE_PATH);
  const port = numberFromEnv(env.PORT, 3001);
  const dataDirectory = resolve(env.MACROGRAPH_DATA_DIR ?? ".");
  const publicOrigin = normalizePublicOrigin(
    env.MACROGRAPH_PUBLIC_ORIGIN ?? `http://localhost:${port}`,
  );
  return {
    basePath,
    port,
    host: env.HOST ?? "0.0.0.0",
    dataDirectory,
    databasePath: resolve(dataDirectory, "project.db"),
    cloudAuthPath: resolve(dataDirectory, "macrograph-auth.json"),
    clientAuthPath: resolve(dataDirectory, "macrograph-client-auth.json"),
    cloudBaseUrl: optionalEnv(env.MACROGRAPH_CLOUD_BASE_URL) ?? "https://www.macrograph.app/api",
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
    otlpEndpoint: optionalEnv(env.OTEL_EXPORTER_OTLP_ENDPOINT),
    browserOtlpEndpoint: optionalEnv(env.MACROGRAPH_BROWSER_OTLP_ENDPOINT),
  };
};

export * as ServerConfig from "./ServerConfig.ts";
