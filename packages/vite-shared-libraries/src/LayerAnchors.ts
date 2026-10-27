import * as stylex from "@stylexjs/stylex";

// StyleX names its CSS layers by position among the priority levels present in a stylesheet,
// not by the level itself. These never-applied rules put every level in every stylesheet so that
// `stylex.priorityN` means the same thing in the host's CSS and in each module's CSS.

// Priority 0 keeps the level 0 group unlayered, as it is in the host's stylesheet.
export const layerAnchorKeyframes = stylex.keyframes({ to: { opacity: 1 } });

export const layerAnchors = stylex.create({
  levels: {
    "--macrograph-layer-anchor": "0",
    inset: 0,
    margin: 0,
    marginBlock: 0,
    color: "inherit",
    marginTop: 0,
    "::before": {
      "--macrograph-layer-anchor": "0",
      inset: 0,
      margin: 0,
      marginBlock: 0,
      color: "inherit",
      marginTop: 0,
    },
  },
});
