/** The element the website reads its first-render data from (`apps/website/src/initialData.ts`). */
export const elementId = "macrograph-initial-data";

/** Pages whose data the Worker looks up and embeds, keyed by path, mapped to the API that has it. */
export const pages: Readonly<Record<string, string>> = {
  "/device": "/api/website/device",
};

/**
 * Embeds JSON in the page's `<head>`. `<` is escaped so the data can never close the script
 * element, whatever strings it contains.
 */
export const inject = (html: string, data: unknown) => {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  const script = `<script id="${elementId}" type="application/json">${json}</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${script}</head>`) : script + html;
};

export * as InitialData from "./InitialData.ts";
