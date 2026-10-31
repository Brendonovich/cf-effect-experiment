import type { QueryClient } from "@tanstack/solid-query";

import { getRequestEvent, isServer } from "@solidjs/web";
import { dehydrate, hydrate } from "@tanstack/solid-query";

/**
 * Hands the server render's query cache to the browser, so hydration renders from the same data.
 *
 * Solid Query streams its own copy too, but applies it only after the first client render, which
 * would then show loading states the server never sent. So `App` registers its client on the
 * request event, `middleware.ts` embeds the settled cache in the page once the render completes,
 * and the browser hydrates its client before anything renders.
 */
const elementId = "macrograph-query-state";
const localsKey = "queryClient";

/** Called by `App` with the client it renders with. */
export const registerQueryClient = (client: QueryClient) => {
  if (isServer) {
    const event = getRequestEvent();
    if (event !== undefined) event.locals[localsKey] = client;
    return;
  }
  const text = document.getElementById(elementId)?.textContent;
  if (text) hydrate(client, JSON.parse(text));
};

/** Adds the request's dehydrated cache to a rendered page. */
export const embedQueryState = (html: string, locals: Readonly<Record<string, unknown>>) => {
  const client = locals[localsKey] as QueryClient | undefined;
  if (client === undefined) return html;
  // `<` is escaped so no value can close the script element.
  const json = JSON.stringify(dehydrate(client)).replaceAll("<", "\\u003c");
  const script = `<script id="${elementId}" type="application/json">${json}</script>`;
  return html.includes("</head>") ? html.replace("</head>", `${script}</head>`) : script + html;
};
