import * as stylex from "@stylexjs/stylex";
import { For, Show, createMemo, type Component } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { wireGeometry, wireSegments } from "./graphPresentation";

const styles = stylex.create({
  smooth: {
    transitionDuration: { default: "40ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    transitionProperty: "d, transform",
    transitionTimingFunction: "linear",
  },
  outline: { stroke: colors.gray1 },
});

interface WireProps {
  readonly edge: Parameters<typeof wireSegments>[0];
  /** Animates path and marker movement; disable while an endpoint is being dragged. */
  readonly smooth?: boolean;
}

/** A wire, with a diamond where a converted value changes type. */
export const Wire: Component<WireProps> = (props) => {
  const geometry = createMemo(() => wireGeometry(props.edge));
  const markerTransform = createMemo(() => {
    const marker = geometry().marker;
    return marker === undefined
      ? undefined
      : `translate(${marker.x}px, ${marker.y}px) rotate(${marker.angle}deg)`;
  });

  return (
    <>
      <For each={geometry().segments}>
        {(segment) => (
          <path
            sx={props.smooth === true && styles.smooth}
            d={segment.path}
            fill="none"
            stroke={segment.stroke}
            stroke-width="2"
            opacity="0.75"
          />
        )}
      </For>
      <Show when={geometry().marker}>
        {(marker) => (
          <g sx={props.smooth === true && styles.smooth} style={{ transform: markerTransform() }}>
            <path d="M -7 0 L 0 -7 L 0 7 Z" fill={marker().source} />
            <path d="M 0 -7 L 7 0 L 0 7 Z" fill={marker().target} />
            <path
              sx={styles.outline}
              d="M -7 0 L 0 -7 L 7 0 L 0 7 Z"
              fill="none"
              stroke-width="1.5"
            />
          </g>
        )}
      </Show>
    </>
  );
};
