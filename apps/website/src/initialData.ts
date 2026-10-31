import type { DeviceRequest, Session } from "./api";

/** Data the website's Worker embeds in some pages so they render complete on first load. */
export interface InitialData {
  readonly session?: Session | null;
  /** On `/device?user_code=…`: the request for that code, or `null` when it isn't valid. */
  readonly device?: { readonly userCode: string; readonly request: DeviceRequest | null };
}

/** Kept in `apps/cloud/src/website/InitialData.ts`. */
const elementId = "macrograph-initial-data";

/** Reads the embedded data; pages served without it (such as in development) get `{}`. */
export const initialData = (): InitialData => {
  const text =
    typeof document === "undefined" ? null : document.getElementById(elementId)?.textContent;
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    return typeof parsed === "object" && parsed !== null ? (parsed as InitialData) : {};
  } catch {
    return {};
  }
};
