import { type JSX, dynamic } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";

import { colors } from "../tokens.stylex.ts";

type BrandIcon = (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element;

interface ProviderBrand {
  readonly icon: BrandIcon;
  readonly tile: stylex.StyleXStyles;
  readonly description: string;
}

const tiles = stylex.create({
  twitch: { backgroundColor: "#9146ff", color: "#ffffff" },
  discord: { backgroundColor: "#5865f2", color: "#ffffff" },
  github: { backgroundColor: "#000000", color: "#ffffff" },
  spotify: { backgroundColor: "#000000", color: "#1ed760" },
  google: { backgroundColor: "#ffffff", color: "#4285f4" },
  patreon: { backgroundColor: "#ff424d", color: "#ffffff" },
  streamlabs: { backgroundColor: "#80f5d2", color: "#09161d" },
});

const brands: Record<string, ProviderBrand> = {
  twitch: {
    icon: IconSimpleIconsTwitch,
    tile: tiles.twitch,
    description: "Chat, channel points, and stream events",
  },
  discord: {
    icon: IconSimpleIconsDiscord,
    tile: tiles.discord,
    description: "Servers, channels, and messages",
  },
  github: {
    icon: IconSimpleIconsGithub,
    tile: tiles.github,
    description: "Repositories, issues, and webhooks",
  },
  spotify: {
    icon: IconSimpleIconsSpotify,
    tile: tiles.spotify,
    description: "Playback and listening activity",
  },
  google: {
    icon: IconSimpleIconsGoogle,
    tile: tiles.google,
    description: "Account profile and Google services",
  },
  patreon: {
    icon: IconSimpleIconsPatreon,
    tile: tiles.patreon,
    description: "Memberships and pledges",
  },
  streamlabs: {
    icon: IconSimpleIconsStreamlabs,
    tile: tiles.streamlabs,
    description: "Donations and stream alerts",
  },
};

export const providerDescription = (provider: string, displayName: string) =>
  brands[provider]?.description ?? `Connect a ${displayName} account`;

const styles = stylex.create({
  tile: {
    display: "grid",
    flexShrink: 0,
    placeItems: "center",
    width: 32,
    height: 32,
    borderColor: "rgb(255 255 255 / 0.08)",
    borderRadius: 7,
    borderStyle: "solid",
    borderWidth: 1,
  },
  fallback: { backgroundColor: colors.gray4, color: colors.gray11 },
  icon: { width: 17, height: 17 },
  letter: { fontSize: 14, fontWeight: 600, textTransform: "uppercase" },
});

export function ProviderIcon(props: { readonly provider: string }) {
  const brand = () => brands[props.provider];
  const Icon = dynamic(() => brand()?.icon);
  return (
    <Show
      when={brand()}
      fallback={
        <span aria-hidden="true" sx={[styles.tile, styles.fallback]}>
          <span sx={styles.letter}>{props.provider.slice(0, 1)}</span>
        </span>
      }
    >
      {(brand) => (
        <span aria-hidden="true" sx={[styles.tile, brand().tile]}>
          <Icon {...stylex.attrs(styles.icon)} />
        </span>
      )}
    </Show>
  );
}
