import type { JSX } from "@solidjs/web";

import { HydrationScript } from "@solidjs/web";

import "./index.css";

/** The HTML shell the server renders every page into; start mode injects the client entry. */
export default function Document(props: { readonly children?: JSX.Element }) {
  return (
    <html lang="en" class="dark dark-theme">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta
          name="description"
          content="MacroGraph provides a node-based programming environment for streamers to build custom interactions and automations."
        />
        <link rel="icon" href="/favicon.png" />
        <title>MacroGraph</title>
        <HydrationScript />
        {/* StyleX adds this to `index.html` in dev; start mode has none. It keeps the dev stylesheet
        current, including for code loaded after the first render, such as the playground. */}
        {import.meta.env.DEV ? <script type="module" src="/@id/virtual:stylex:runtime" /> : null}
      </head>
      <body>{props.children}</body>
    </html>
  );
}
