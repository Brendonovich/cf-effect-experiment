import type { JSX } from "@solidjs/web";

import { ButtonLink, macrographLogo } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { For } from "solid-js";

import discordLogo from "../assets/integrations/discord.png";
import goxlrLogo from "../assets/integrations/goxlr.png";
import midiLogo from "../assets/integrations/midi.svg";
import obsLogo from "../assets/integrations/obs.png";
import openaiLogo from "../assets/integrations/openai.png";
import speakerBotLogo from "../assets/integrations/speaker-bot.svg";
import streamDeckLogo from "../assets/integrations/stream-deck.jpg";
import streamlabsLogo from "../assets/integrations/streamlabs.png";
import twitchLogo from "../assets/integrations/twitch.png";
import vtubeStudioLogo from "../assets/integrations/vtube-studio.png";
import websocketsLogo from "../assets/integrations/websockets.webp";
import { Header } from "../Header";
import { DownloadMenu } from "./DownloadMenu";

export function LandingRoute() {
  return (
    <div sx={styles.page}>
      <Header />
      <main sx={styles.main}>
        <section sx={styles.hero}>
          <img src={macrographLogo} alt="MacroGraph app icon" sx={styles.appIcon} />
          <h1 sx={styles.title}>MacroGraph</h1>
          <p sx={styles.tagline}>Visual programming for streamers</p>
          <p sx={styles.description}>
            MacroGraph provides a node-based programming environment for streamers to build custom
            interactions and automations. It acts as glue between your services and programs, taking
            care of connecting to them so you can focus on creating.
          </p>
          <div sx={styles.actions}>
            <ButtonLink href="/playground" sx={styles.action}>
              <IconTablerSandbox {...stylex.attrs(styles.actionIcon)} />
              Playground
            </ButtonLink>
            <DownloadMenu />
          </div>
          <nav sx={styles.socials} aria-label="MacroGraph on social media">
            <For each={socials}>
              {(social) => {
                const Icon = social.icon;
                return (
                  <a
                    href={social.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={social.label}
                    sx={styles.social}
                  >
                    <Icon {...stylex.attrs(styles.socialIcon)} />
                  </a>
                );
              }}
            </For>
          </nav>
        </section>

        <section sx={styles.integrations}>
          <h2 sx={styles.sectionTitle}>Integrations</h2>
          <p sx={styles.sectionDescription}>
            MacroGraph can receive events from and send commands to all sorts of programs and
            services
          </p>
          <ul sx={styles.grid}>
            <For each={integrations}>
              {(item) => (
                <li sx={styles.card}>
                  <img src={item.logo} alt="" sx={styles.cardLogo} />
                  <div sx={styles.cardBody}>
                    <h3 sx={styles.cardTitle}>{item.name}</h3>
                    <p sx={styles.cardDescription}>{item.description}</p>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>
      </main>
    </div>
  );
}

const md = "@media (min-width: 768px)";
const styles = stylex.create({
  page: { minHeight: "100dvh", backgroundColor: colors.gray1, color: colors.gray12 },
  main: {
    width: "100%",
    maxWidth: 960,
    boxSizing: "border-box",
    marginInline: "auto",
    paddingInline: 24,
    paddingBottom: 96,
  },
  hero: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: { default: 64, [md]: 104 },
    textAlign: "center",
  },
  appIcon: {
    width: { default: 96, [md]: 128 },
    height: { default: 96, [md]: 128 },
    borderRadius: { default: 22, [md]: 28 },
    boxShadow: "0 16px 48px rgb(0 0 0 / 0.45)",
  },
  title: {
    margin: 0,
    marginTop: 28,
    fontSize: { default: 44, [md]: 64 },
    lineHeight: 1,
    fontWeight: 800,
    letterSpacing: "-0.035em",
  },
  tagline: {
    margin: 0,
    marginTop: 12,
    fontSize: { default: 20, [md]: 26 },
    fontWeight: 500,
    color: colors.focus,
  },
  description: {
    margin: 0,
    marginTop: 20,
    maxWidth: 620,
    fontSize: 16,
    lineHeight: "26px",
    color: colors.gray11,
  },
  actions: { display: "flex", gap: 12, marginTop: 32 },
  action: { gap: 8, height: 44, paddingInline: 20, borderRadius: 8, fontSize: 15 },
  actionIcon: { width: 18, height: 18 },
  socials: { display: "flex", gap: 4, marginTop: 20 },
  social: {
    display: "grid",
    placeItems: "center",
    width: 40,
    height: 40,
    borderRadius: 8,
    color: { default: colors.gray10, ":hover": colors.gray12 },
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
  },
  socialIcon: { width: 22, height: 22 },
  integrations: { marginTop: { default: 96, [md]: 136 } },
  sectionTitle: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    textAlign: "center",
  },
  sectionDescription: {
    margin: 0,
    marginTop: 8,
    fontSize: 15,
    color: colors.gray11,
    textAlign: "center",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "1fr", [md]: "repeat(2, minmax(0, 1fr))" },
    gap: 12,
    marginTop: 32,
    padding: 0,
    listStyle: "none",
  },
  card: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: 16,
    borderColor: { default: colors.gray5, ":hover": colors.gray7 },
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: colors.gray2,
    transitionProperty: "border-color",
    transitionDuration: "150ms",
  },
  cardLogo: {
    flexShrink: 0,
    width: 48,
    height: 48,
    borderRadius: 8,
    objectFit: "contain",
  },
  cardBody: { minWidth: 0 },
  cardTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  cardDescription: {
    margin: 0,
    marginTop: 2,
    fontSize: 13,
    lineHeight: "20px",
    color: colors.gray11,
  },
  inlineLink: { color: colors.gray12, textDecoration: "underline" },
});

const integrations: ReadonlyArray<{
  readonly name: string;
  readonly description: JSX.Element;
  readonly logo: string;
}> = [
  { name: "OBS", description: "Modify and listen to changes in all aspects of OBS", logo: obsLogo },
  { name: "Twitch", description: "Interact with Chat, EventSub, and Helix", logo: twitchLogo },
  {
    name: "VTube Studio",
    description: "Execute hotkeys and control models",
    logo: vtubeStudioLogo,
  },
  {
    name: "Streamlabs",
    description: "Listen for donations and YouTube events",
    logo: streamlabsLogo,
  },
  {
    name: "Discord",
    description: "Send and receive messages, and interact with the Discord API",
    logo: discordLogo,
  },
  { name: "Speaker.bot", description: "Trigger and stop text-to-speech", logo: speakerBotLogo },
  {
    name: "WebSockets",
    description: "Connect to WebSocket servers and host your own",
    logo: websocketsLogo,
  },
  {
    name: "GoXLR",
    description: "Control and listen to buttons, dials, faders, and channels",
    logo: goxlrLogo,
  },
  {
    name: "Elgato Stream Deck",
    description: (
      <>
        Listen to button presses via the{" "}
        <a
          href="https://marketplace.elgato.com/product/websocket-proxy-5ed6a37a-d6e9-4c95-aa95-42ded37ecff1"
          target="_blank"
          rel="noopener noreferrer"
          sx={styles.inlineLink}
        >
          WebSocket Proxy plugin
        </a>
      </>
    ),
    logo: streamDeckLogo,
  },
  {
    name: "MIDI",
    description: "Send and receive MIDI messages to and from MIDI devices",
    logo: midiLogo,
  },
  {
    name: "OpenAI",
    description: "Generate text with ChatGPT and images with Dall-E",
    logo: openaiLogo,
  },
];

const socials = [
  { label: "Discord", href: "https://discord.gg/FEyYaC8v53", icon: IconIcBaselineDiscord },
  { label: "X", href: "https://x.com/macrographio", icon: IconRiTwitterXFill },
  { label: "GitHub", href: "https://github.com/brendonovich/macrograph", icon: IconMdiGithub },
];
