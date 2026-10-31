import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";

import { colors } from "../tokens.stylex.ts";

export type DescriptionSegment =
  | { readonly text: string }
  | { readonly text: string; readonly href: string };

const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Splits a description into text and its markdown `[text](https://…)` links. */
export const descriptionSegments = (description: string): ReadonlyArray<DescriptionSegment> => {
  const segments: Array<DescriptionSegment> = [];
  let index = 0;
  for (const match of description.matchAll(linkPattern)) {
    if (match.index > index) segments.push({ text: description.slice(index, match.index) });
    segments.push({ text: match[1]!, href: match[2]! });
    index = match.index + match[0].length;
  }
  if (index < description.length) segments.push({ text: description.slice(index) });
  return segments;
};

/** A description with its markdown links reduced to their text, for tooltips and search. */
export const plainDescription = (description: string) =>
  description.replace(linkPattern, (_match, text: string) => text);

const styles = stylex.create({
  link: {
    borderRadius: 2,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    outline: "none",
    textDecoration: "underline",
    boxShadow: { default: null, ":focus-visible": `0 0 0 1px ${colors.focus}` },
  },
});

/** Renders a description, opening its markdown links in a new tab. */
export function Description(props: { readonly text: string }) {
  return (
    <For each={descriptionSegments(props.text)}>
      {(segment) => (
        <Show when={"href" in segment ? segment.href : undefined} fallback={segment.text}>
          {(href) => (
            <a sx={styles.link} href={href()} target="_blank" rel="noreferrer">
              {segment.text}
            </a>
          )}
        </Show>
      )}
    </For>
  );
}
