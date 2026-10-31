import type { JSX } from "@solidjs/web";

import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import {
  BrowserPageView,
  BrowserWindow,
  CopyButton,
  Terminal,
  appTab,
  approvalFrameDuration,
  exampleUserCode,
  serverTab,
  type BrowserPage,
  type BrowserTab,
  type TerminalLine,
} from "./ServerSetupVisuals";

const image = "ghcr.io/brendonovich/macrograph-server:beta";

const runCommand = `docker run -d --name macrograph --restart unless-stopped \\
  -p 3001:3001 -v macrograph-data:/data \\
  ${image}`;

const composeFile = `services:
  macrograph:
    image: ${image}
    container_name: macrograph
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - macrograph-data:/data

volumes:
  macrograph-data:`;

const updateCommand = `docker pull ${image}
docker rm -f macrograph
${runCommand}`;

const exampleKey = "kD3vQm8Zr1pXw7NcY2tLh5sF0gJb9uAeE4oVi6nRk-c";
const setupLink = `http://localhost:3001/#setup-key=${exampleKey}`;

const environment: ReadonlyArray<{ readonly name: string; readonly description: JSX.Element }> = [
  {
    name: "MACROGRAPH_PUBLIC_ORIGIN",
    description: (
      <>
        The address people use to reach the server, such as{" "}
        <Code>https://macrograph.example.com</Code>. Setup links use it, so set it when the server
        isn't on <Code>localhost</Code>.
      </>
    ),
  },
  {
    name: "MACROGRAPH_SERVER_NAME",
    description: "The name shown when approving the server. Defaults to the container's hostname.",
  },
  {
    name: "MACROGRAPH_ADMIN_IDS",
    description:
      "Comma-separated MacroGraph user IDs that can edit the project, in addition to the owner.",
  },
  {
    name: "PORT",
    description: (
      <>
        The port the server listens on inside the container. Defaults to <Code>3001</Code>.
      </>
    ),
  },
];

// Kept as constants so a step's lines are the same objects each time, and stay put in scrollback.
const startLines: ReadonlyArray<TerminalLine> = [
  { type: "command", text: runCommand },
  { type: "output", text: `Unable to find image '${image}' locally` },
  { type: "output", text: "beta: Pulling from brendonovich/macrograph-server" },
  { type: "output", text: `Status: Downloaded newer image for ${image}` },
  { type: "output", text: "7c2d9e41b8a3f05e6d1c9a8b7e6f5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c4" },
];

const logLines: ReadonlyArray<TerminalLine> = [
  { type: "command", text: "docker logs macrograph" },
  { type: "output", text: "MACROGRAPH_LISTENING 3001" },
  { type: "output", text: `MACROGRAPH_SETUP_KEY ${exampleKey}` },
  {
    type: "output",
    text: `[18:42:07.512] INFO (#3): Open ${setupLink} to set up this server.`,
    link: setupLink,
  },
  { type: "output", text: "[18:42:07.631] INFO (#3): Listening on http://0.0.0.0:3001" },
];

/** What a step's preview shows. Steps in a row with the same type share one window. */
type Visual =
  | {
      readonly type: "terminal";
      readonly lines: ReadonlyArray<TerminalLine>;
      readonly copy: string;
    }
  | {
      readonly type: "browser";
      readonly tabs: ReadonlyArray<BrowserTab>;
      readonly activeTab: number;
      readonly page: BrowserPage;
    };

const browserLabels: Record<BrowserPage, string> = {
  setup: "The server's setup page",
  approve: "Approving the server on macrograph.app",
  editor: "The MacroGraph editor running on the server",
};

/**
 * Shows a step's preview. A terminal keeps `scrollback`, the lines of the terminal steps before
 * it, and a browser window stays open while its tabs and page change.
 */
function StepPreview(props: {
  readonly visual: Visual;
  readonly scrollback: ReadonlyArray<ReadonlyArray<TerminalLine>>;
}) {
  const terminal = () => (props.visual.type === "terminal" ? props.visual : undefined);
  const browser = () => (props.visual.type === "browser" ? props.visual : undefined);
  return (
    <>
      <Show when={terminal()}>
        {(current) => (
          <div sx={[styles.previewFrame, styles.terminalFrame]}>
            <Terminal groups={[...props.scrollback, current().lines]} copy={current().copy} />
          </div>
        )}
      </Show>
      <Show when={browser()}>
        {(current) => (
          <div sx={styles.previewFrame}>
            <BrowserWindow
              tabs={current().tabs}
              activeTab={current().activeTab}
              label={browserLabels[current().page]}
            >
              <BrowserPageView page={current().page} />
            </BrowserWindow>
          </div>
        )}
      </Show>
    </>
  );
}

/** A step whose preview plays through several parts, which its text can jump between. */
interface Sequence {
  readonly frame: () => number;
  readonly select: (frame: number) => void;
}

const claimParts: ReadonlyArray<() => JSX.Element> = [
  () => (
    <>
      Choose <strong>Continue with MacroGraph</strong>.
    </>
  ),
  () => (
    <>
      macrograph.app opens in a new tab. Sign in if you need to, check the code matches the one on
      your server's tab (like <Code>{exampleUserCode}</Code>), and choose <strong>Approve</strong>.
    </>
  ),
];

interface Step {
  readonly title: string;
  /** How many parts the preview plays through, if more than one. */
  readonly frames?: number;
  readonly body: (sequence: Sequence) => JSX.Element;
  readonly visual: (sequence: Sequence) => Visual;
}

const steps: ReadonlyArray<Step> = [
  {
    title: "Start the container",
    visual: () => ({ type: "terminal", lines: startLines, copy: runCommand }),
    body: () => (
      <>
        <p sx={styles.text}>
          Run this on the machine that will host MacroGraph. Docker downloads the image and starts
          it in the background, restarting it whenever the machine reboots.
        </p>
        <p sx={styles.text}>
          Your project is kept in the <Code>macrograph-data</Code> volume, so it survives restarts
          and updates.
        </p>
        <details sx={styles.details}>
          <summary sx={styles.summary}>Using Docker Compose instead?</summary>
          <p sx={styles.text}>
            Save this as <Code>compose.yaml</Code> and run <Code>docker compose up -d</Code>.
          </p>
          <CodeBlock>{composeFile}</CodeBlock>
        </details>
      </>
    ),
  },
  {
    title: "Open your setup link",
    visual: () => ({ type: "terminal", lines: logLines, copy: "docker logs macrograph" }),
    body: () => (
      <>
        <p sx={styles.text}>
          The first time it starts, the server prints a one-time setup link to its logs. Open it in
          your browser.
        </p>
        <p sx={styles.text}>
          If the server is on another machine, use its address instead of <Code>localhost</Code>,
          then paste the <Code>MACROGRAPH_SETUP_KEY</Code> when asked. Setting{" "}
          <Code>MACROGRAPH_PUBLIC_ORIGIN</Code> makes the printed link use that address.
        </p>
        <p sx={styles.text}>
          Anyone with the link can claim the server, so keep your logs private until you're done. It
          changes whenever an unclaimed server restarts.
        </p>
      </>
    ),
  },
  {
    title: "Claim your server",
    frames: claimParts.length,
    visual: (sequence) =>
      sequence.frame() === 0
        ? { type: "browser", tabs: [serverTab], activeTab: 0, page: "setup" }
        : { type: "browser", tabs: [serverTab, appTab], activeTab: 1, page: "approve" },
    body: (sequence) => (
      <>
        <ol sx={styles.parts}>
          <For each={claimParts}>
            {(part, index) => (
              <li>
                <button
                  type="button"
                  sx={[styles.part, sequence.frame() === index() && styles.partActive]}
                  aria-current={sequence.frame() === index() ? "step" : undefined}
                  onClick={() => sequence.select(index())}
                >
                  {part()}
                </button>
              </li>
            )}
          </For>
        </ol>
        <p sx={styles.text}>
          The account you approve with becomes the server's owner, and the server can use the
          accounts you've connected to MacroGraph, like Twitch and Discord. You can remove it any
          time under <strong>Account → Apps</strong>.
        </p>
      </>
    ),
  },
  {
    title: "Start building",
    visual: () => ({ type: "browser", tabs: [serverTab, appTab], activeTab: 0, page: "editor" }),
    body: () => (
      <p sx={styles.text}>
        Head back to your server's tab. You're signed in as its owner, and the editor is ready.
      </p>
    ),
  },
];

export function ServerSetupRoute() {
  return (
    <main sx={styles.main}>
      <header sx={styles.intro}>
        <h1 sx={styles.title}>Set up a server</h1>
        <p sx={styles.lead}>
          A MacroGraph server runs your project around the clock on your own hardware, such as a
          home server, NAS, or VPS. You edit it from the browser, and changes apply immediately. All
          you need is Docker; the image runs on both <Code>amd64</Code> and <Code>arm64</Code>.
        </p>
      </header>

      <Walkthrough />

      <section sx={styles.reference}>
        <h2 sx={styles.heading}>Updating</h2>
        <p sx={styles.text}>
          Pull the latest image and recreate the container with the same volume. Your project and
          sign-in are kept.
        </p>
        <CodeBlock>{updateCommand}</CodeBlock>
        <p sx={styles.text}>
          With Compose, run <Code>docker compose pull</Code> then <Code>docker compose up -d</Code>.
        </p>

        <h2 sx={styles.heading}>Configuration</h2>
        <p sx={styles.text}>
          Pass these to <Code>docker run</Code> with <Code>-e NAME=value</Code>, or under{" "}
          <Code>environment</Code> in Compose.
        </p>
        <dl sx={styles.envList}>
          <For each={environment}>
            {(variable) => (
              <div sx={styles.envItem}>
                <dt>
                  <Code>{variable.name}</Code>
                </dt>
                <dd sx={styles.envDescription}>{variable.description}</dd>
              </div>
            )}
          </For>
        </dl>

        <h2 sx={styles.heading}>Remote access</h2>
        <p sx={styles.text}>
          To reach the server from other devices, put it behind a reverse proxy with HTTPS and set{" "}
          <Code>MACROGRAPH_PUBLIC_ORIGIN</Code> to its public address. The proxy must forward
          WebSocket connections.
        </p>

        <h2 sx={styles.heading}>Backups</h2>
        <p sx={styles.text}>
          Everything the server keeps, including the project, module settings, and who owns the
          server, lives in <Code>/data</Code>. Back up the whole volume, and keep it private: it
          contains sign-in data and module credentials. If you bind-mount a directory instead of
          using a volume, make it writable by user <Code>1000:1000</Code>.
        </p>
      </section>
    </main>
  );
}

function Walkthrough() {
  const [active, setActive] = createSignal(0);
  const [frame, setFrame] = createSignal(0);
  const isLast = () => active() === steps.length - 1;
  const show = (step: number) => {
    setActive(step);
    setFrame(0);
  };
  const sequence: Sequence = { frame, select: setFrame };
  const visual = createMemo(() => steps[active()]!.visual(sequence));
  // The lines of the terminal steps leading up to this one, while they share its terminal.
  const scrollback = createMemo(() => {
    const lines: Array<ReadonlyArray<TerminalLine>> = [];
    for (let step = active() - 1; step >= 0; step--) {
      const previous = steps[step]!.visual(sequence);
      if (previous.type !== "terminal") break;
      lines.unshift(previous.lines);
    }
    return lines;
  });
  // Plays the open step's preview through its parts once, stopping on the last.
  createEffect(
    () => [active(), frame()] as const,
    ([step, current]) => {
      if (current >= (steps[step]?.frames ?? 1) - 1) return;
      const timer = setTimeout(() => setFrame(current + 1), approvalFrameDuration);
      return () => clearTimeout(timer);
    },
  );
  const controls = () => (
    <div sx={styles.controls}>
      <Button
        type="button"
        variant="secondary"
        disabled={active() === 0}
        onClick={() => show(active() - 1)}
      >
        Back
      </Button>
      <span sx={styles.progress}>
        Step {active() + 1} of {steps.length}
      </span>
      <Button type="button" disabled={isLast()} onClick={() => show(active() + 1)}>
        Next
      </Button>
    </div>
  );
  return (
    <div sx={styles.walkthrough}>
      <ol sx={styles.steps}>
        <For each={steps}>
          {(step, index) => (
            <li sx={[styles.step, active() === index() && styles.stepActive]}>
              <h2 sx={styles.stepHeading}>
                <button
                  type="button"
                  sx={styles.stepButton}
                  aria-expanded={active() === index() ? "true" : "false"}
                  aria-controls={`server-setup-step-${index()}`}
                  onClick={() => show(index())}
                >
                  <span
                    sx={[
                      styles.stepNumber,
                      active() === index() && styles.stepNumberActive,
                      index() < active() && styles.stepNumberDone,
                    ]}
                  >
                    <Show when={index() < active()} fallback={index() + 1}>
                      <IconTablerCheck {...stylex.attrs(styles.stepCheck)} />
                    </Show>
                  </span>
                  {step.title}
                </button>
              </h2>
              <div
                id={`server-setup-step-${index()}`}
                inert={active() !== index()}
                sx={[styles.stepCollapse, active() === index() && styles.stepCollapseOpen]}
              >
                <div sx={styles.stepClip}>
                  <div sx={[styles.stepBody, active() === index() && styles.stepBodyOpen]}>
                    {step.body(sequence)}
                  </div>
                </div>
              </div>
            </li>
          )}
        </For>
      </ol>
      <div sx={styles.preview}>
        <StepPreview visual={visual()} scrollback={scrollback()} />
        {controls()}
      </div>
      <ol sx={styles.flat}>
        <For each={steps}>{(step, index) => <FlatStep step={step} number={index() + 1} />}</For>
      </ol>
    </div>
  );
}

/**
 * A step in the narrow layout, where every step reads in order as part of the page. A preview with
 * several parts loops through them.
 */
function FlatStep(props: { readonly step: Step; readonly number: number }) {
  const [frame, setFrame] = createSignal(0);
  const sequence: Sequence = { frame, select: setFrame };
  createEffect(frame, (current) => {
    const frames = props.step.frames ?? 1;
    if (frames < 2) return;
    const timer = setTimeout(() => setFrame((current + 1) % frames), approvalFrameDuration);
    return () => clearTimeout(timer);
  });
  return (
    <li sx={styles.flatStep}>
      <h2 sx={styles.flatTitle}>
        <span sx={[styles.stepNumber, styles.stepNumberActive]}>{props.number}</span>
        {props.step.title}
      </h2>
      <StepPreview visual={props.step.visual(sequence)} scrollback={[]} />
      <div>{props.step.body(sequence)}</div>
    </li>
  );
}

function Code(props: { readonly children: JSX.Element }) {
  return <code sx={styles.code}>{props.children}</code>;
}

function CodeBlock(props: { readonly children: string }) {
  return (
    <div sx={styles.codeBlock}>
      <pre sx={styles.pre}>
        <code>{props.children}</code>
      </pre>
      <span sx={styles.codeCopy}>
        <CopyButton text={props.children} />
      </span>
    </div>
  );
}

const fadeIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(6px)" },
  to: { opacity: 1, transform: "none" },
});

const reducedMotion = "@media (prefers-reduced-motion: reduce)";
const stepDuration = "280ms";
const stepEasing = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
// Past the phone layout, the steps and preview sit side by side. The docs sidebar collapses
// before this, at a wider width.
const md = "@media (min-width: 768px)";
const styles = stylex.create({
  // The docs shell sets the page's width and side padding.
  main: {
    maxWidth: 1120,
    paddingTop: { default: 20, [md]: 40 },
    paddingBottom: { default: 48, [md]: 96 },
  },
  intro: { maxWidth: 680 },
  title: {
    margin: 0,
    fontSize: { default: 24, [md]: 32 },
    fontWeight: 700,
    letterSpacing: "-0.025em",
  },
  lead: {
    margin: 0,
    marginTop: { default: 8, [md]: 12 },
    fontSize: { default: 14, [md]: 15 },
    lineHeight: { default: "22px", [md]: "24px" },
    color: colors.gray11,
  },
  walkthrough: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr)", [md]: "minmax(0, 5fr) minmax(0, 7fr)" },
    alignItems: "start",
    gap: { default: 0, [md]: 40 },
    marginTop: { default: 12, [md]: 40 },
  },
  steps: {
    display: { default: "none", [md]: "flex" },
    flexDirection: "column",
    gap: 4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  step: {
    borderColor: "transparent",
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 10,
    transitionProperty: "background-color, border-color",
    transitionDuration: { default: stepDuration, [reducedMotion]: "0ms" },
    transitionTimingFunction: stepEasing,
  },
  stepActive: { borderColor: colors.gray5, backgroundColor: colors.gray2 },
  stepHeading: { margin: 0 },
  stepButton: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: 12,
    borderWidth: 0,
    borderRadius: 10,
    backgroundColor: "transparent",
    color: { default: colors.gray11, ":hover": colors.gray12 },
    fontFamily: "inherit",
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
    outlineOffset: -2,
  },
  stepNumber: {
    display: "grid",
    flexShrink: 0,
    placeItems: "center",
    width: 26,
    height: 26,
    borderRadius: 9999,
    backgroundColor: colors.gray4,
    fontSize: 12,
    fontWeight: 600,
    color: colors.gray11,
    transitionProperty: "background-color, color",
    transitionDuration: { default: stepDuration, [reducedMotion]: "0ms" },
    transitionTimingFunction: stepEasing,
  },
  stepNumberActive: { backgroundColor: colors.gray12, color: colors.gray1 },
  stepNumberDone: { backgroundColor: colors.gray5, color: colors.gray12 },
  stepCheck: { width: 14, height: 14 },
  // Animates between collapsed and open without measuring the content.
  stepCollapse: {
    display: "grid",
    gridTemplateRows: "0fr",
    transitionProperty: "grid-template-rows",
    transitionDuration: { default: stepDuration, [reducedMotion]: "0ms" },
    transitionTimingFunction: stepEasing,
  },
  stepCollapseOpen: { gridTemplateRows: "1fr" },
  stepClip: { minHeight: 0, overflow: "hidden" },
  stepBody: {
    paddingInline: 12,
    paddingBottom: 14,
    // Lines the text up with the title, past the number.
    paddingLeft: { default: 12, [md]: 50 },
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: { default: "150ms", [reducedMotion]: "0ms" },
    transitionTimingFunction: "ease-out",
  },
  // Text fades in once the step has mostly opened, and out straight away when it closes.
  stepBodyOpen: {
    opacity: 1,
    transitionDuration: { default: "200ms", [reducedMotion]: "0ms" },
    transitionDelay: { default: "100ms", [reducedMotion]: "0ms" },
  },
  // Cancels the first part's top margin, as with the first paragraph.
  parts: { margin: 0, marginTop: -10, padding: 0, listStyle: "none" },
  // Reads as the step's paragraphs; the one the preview is showing is brighter.
  part: {
    display: "block",
    width: "100%",
    marginTop: 10,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: colors.gray9, ":hover": colors.gray11 },
    fontFamily: "inherit",
    fontSize: 14,
    lineHeight: "22px",
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
    outlineOffset: 2,
    transitionProperty: "color",
    transitionDuration: { default: "200ms", [reducedMotion]: "0ms" },
  },
  partActive: { color: { default: colors.gray12, ":hover": colors.gray12 } },
  // Below the side-by-side breakpoint, the steps read in order as part of the page.
  flat: {
    display: { default: "flex", [md]: "none" },
    flexDirection: "column",
    gap: 40,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  flatStep: { display: "flex", flexDirection: "column", gap: 14 },
  flatTitle: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: 0,
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  preview: {
    display: { default: "none", [md]: "flex" },
    flexDirection: "column",
    gap: 14,
    position: "sticky",
    top: 24,
    minWidth: 0,
  },
  previewFrame: {
    flexShrink: 0,
    height: { default: "clamp(260px, 60vw, 400px)", [md]: 400 },
    animationName: fadeIn,
    animationDuration: { default: "200ms", [reducedMotion]: "1ms" },
    animationTimingFunction: "ease-out",
  },
  // Narrow layouts show a terminal's whole output rather than scrolling it.
  terminalFrame: { height: { default: "auto", [md]: 400 } },
  controls: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  progress: { fontSize: 12, color: colors.gray10 },
  reference: {
    maxWidth: 760,
    marginTop: { default: 56, [md]: 96 },
    paddingTop: { default: 8, [md]: 16 },
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: 1,
  },
  heading: {
    margin: 0,
    marginTop: { default: 32, [md]: 40 },
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  text: {
    margin: 0,
    marginTop: { default: 10, ":first-child": 0 },
    fontSize: 14,
    lineHeight: "22px",
    color: colors.gray11,
  },
  details: { marginTop: 14 },
  summary: {
    width: "fit-content",
    fontSize: 14,
    fontWeight: 500,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    cursor: "pointer",
  },
  code: {
    fontFamily: mono,
    fontSize: "0.9em",
    color: colors.gray12,
  },
  codeBlock: { position: "relative", marginTop: 12 },
  codeCopy: { position: "absolute", top: 8, right: 8 },
  pre: {
    margin: 0,
    padding: 14,
    paddingRight: 80,
    overflowX: "auto",
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray2,
    fontFamily: mono,
    fontSize: 13,
    lineHeight: "20px",
    color: colors.gray12,
  },
  envList: { margin: 0, marginTop: 12 },
  envItem: {
    paddingBlock: 10,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: 1,
  },
  envDescription: {
    margin: 0,
    marginTop: 4,
    fontSize: 14,
    lineHeight: "22px",
    color: colors.gray11,
  },
});
