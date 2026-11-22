import type { ModuleId } from "@macrograph/module";
import type { JSX } from "@solidjs/web";

import { CanvasId, ConnectionId, NodeId, type Package, type RenderedGraph } from "@macrograph/core";
import {
  AccountMenu,
  ServerHeader,
  ServerSetupCard,
  ServerSetupForm,
  SnapshotGraphCanvas,
} from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import {
  For,
  Loading,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  untrack,
} from "solid-js";

import type { DeviceRequest } from "../api";

import { findPackage, usePackageReference } from "../docs/reference";
import { DeviceApproval, DeviceAuthorizationLayout, DeviceCard } from "./DeviceAuthorization";

export function CopyButton(props: { readonly text: string; readonly label?: string }) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const copy = async () => {
    await navigator.clipboard.writeText(props.text);
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      sx={styles.copy}
      aria-label={props.label ?? "Copy"}
      onClick={() => void copy()}
    >
      <Show when={copied()} fallback={<IconTablerCopy {...stylex.attrs(styles.copyIcon)} />}>
        <IconTablerCheck {...stylex.attrs(styles.copyIcon)} />
      </Show>
      {copied() ? "Copied" : "Copy"}
    </button>
  );
}

export type TerminalLine =
  | { readonly type: "command"; readonly text: string }
  /** `link` is part of `text` to show as the link to open. */
  | { readonly type: "output"; readonly text: string; readonly link?: string };

/** Splits a line around its link, so the link can be styled on its own. */
const linkParts = (line: TerminalLine) => {
  const link = line.type === "output" ? line.link : undefined;
  const start = link === undefined ? -1 : line.text.indexOf(link);
  if (link === undefined || start === -1) return { before: line.text, link: "", after: "" };
  return {
    before: line.text.slice(0, start),
    link,
    after: line.text.slice(start + link.length),
  };
};

/**
 * A terminal that prints each group of lines one after another as it appears. Later groups stay
 * below earlier ones, as a session's scrollback, and the terminal scrolls down to them.
 */
export function Terminal(props: {
  readonly groups: ReadonlyArray<ReadonlyArray<TerminalLine>>;
  /** Shows a copy button for this text, usually the command being run. */
  readonly copy?: string;
}) {
  let body: HTMLPreElement | undefined;
  let mounted = false;
  // Opening on several commands at once, such as when going back a step, shows them all
  // together rather than replaying each one.
  const shownAtOnce = new Set(untrack(() => (props.groups.length > 1 ? props.groups : [])));
  // Brings the newest command to the top of the view, so it's never hidden above its output.
  createEffect(
    () => props.groups.length,
    () => {
      const latest = body?.lastElementChild;
      if (body === undefined || latest == null || typeof body.scrollTo !== "function") return;
      const padding = Number.parseFloat(getComputedStyle(body).paddingTop) || 0;
      const top =
        latest.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      body.scrollTo({ top: top - padding, behavior: mounted ? "smooth" : "instant" });
      mounted = true;
    },
  );
  return (
    <div sx={[styles.window, styles.terminal]}>
      <div sx={styles.titleBar}>
        <WindowDots />
        <span sx={styles.terminalTitle}>Terminal</span>
        <Show when={props.copy}>
          {(text) => (
            <span sx={styles.titleEnd}>
              <CopyButton text={text()} label="Copy command" />
            </span>
          )}
        </Show>
      </div>
      <pre ref={(element) => (body = element)} sx={styles.terminalBody}>
        <For each={props.groups}>
          {(lines) => (
            <span sx={[styles.lineGroup, shownAtOnce.has(lines) && styles.groupReveal]}>
              <For each={lines}>
                {(line, index) => (
                  <span
                    style={{ "--line": String(index()) }}
                    sx={[
                      styles.line,
                      line.type === "output" && styles.output,
                      !shownAtOnce.has(lines) && styles.lineReveal,
                    ]}
                  >
                    <Show when={line.type === "command"}>
                      <span sx={styles.prompt} aria-hidden="true">
                        ${" "}
                      </span>
                    </Show>
                    {linkParts(line).before}
                    <Show when={linkParts(line).link}>
                      {(link) => <span sx={styles.link}>{link()}</span>}
                    </Show>
                    {linkParts(line).after}
                  </span>
                )}
              </For>
            </span>
          )}
        </For>
      </pre>
    </div>
  );
}

export interface BrowserTab {
  readonly url: string;
  readonly secure?: boolean;
}

/** A browser window with its open tabs, labelled for screen readers. */
export function BrowserWindow(props: {
  readonly tabs: ReadonlyArray<BrowserTab>;
  /** The tab whose page is showing. */
  readonly activeTab?: number;
  readonly label: string;
  readonly children: JSX.Element;
}) {
  return (
    <figure sx={[styles.window, styles.browser]} aria-label={props.label}>
      <div sx={[styles.titleBar, styles.browserBar]}>
        <WindowDots />
        <span sx={styles.tabs} aria-hidden="true">
          <For each={props.tabs}>
            {(tab, index) => (
              <span sx={[styles.tab, (props.activeTab ?? 0) === index() && styles.tabActive]}>
                <Show
                  when={tab.secure}
                  fallback={<IconTablerInfoCircle {...stylex.attrs(styles.tabIcon)} />}
                >
                  <IconTablerLock {...stylex.attrs(styles.tabIcon)} />
                </Show>
                <span sx={styles.tabUrl}>{tab.url}</span>
              </span>
            )}
          </For>
        </span>
      </div>
      <div sx={styles.browserBody} aria-hidden="true">
        {props.children}
      </div>
    </figure>
  );
}

function WindowDots() {
  return (
    <span sx={styles.dots} aria-hidden="true">
      <span sx={[styles.dot, styles.dotRed]} />
      <span sx={[styles.dot, styles.dotYellow]} />
      <span sx={[styles.dot, styles.dotGreen]} />
    </span>
  );
}

/**
 * Renders real UI at a natural size, shrunk to fit like a screenshot. The page gets at least
 * `width` by `height` pixels, scaled down to fit the window, and fills any room left over. It
 * can't be interacted with; `target` names a button to show the visitor clicking.
 */
function ScaledViewport(props: {
  readonly width: number;
  readonly height: number;
  readonly target?: string;
  readonly children: JSX.Element;
}) {
  // Until it's measured, assume the desktop preview's size.
  const [size, setSize] = createSignal({ width: 600, height: 364 });
  const scale = () => Math.min(1, size().width / props.width, size().height / props.height);
  const [targetBox, setTargetBox] = createSignal<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>();
  let outer: HTMLDivElement | undefined;
  let inner: HTMLDivElement | undefined;
  onSettled(() => {
    const container = outer;
    const root = inner;
    if (container === undefined || root === undefined) return;
    const resize = () => {
      const box = container.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) setSize({ width: box.width, height: box.height });
    };
    const measure = () => {
      const button = [...root.querySelectorAll("button, a")].find(
        (element) => element.textContent?.trim() === props.target,
      );
      if (button === undefined) return setTargetBox(undefined);
      const box = button.getBoundingClientRect();
      const origin = root.getBoundingClientRect();
      const ratio = origin.width / root.offsetWidth;
      setTargetBox({
        x: (box.left - origin.left) / ratio,
        y: (box.top - origin.top) / ratio,
        width: box.width / ratio,
        height: box.height / ratio,
      });
    };
    resize();
    measure();
    // Content that loads later, or a resized window, moves the target.
    const observers: Array<{ disconnect: () => void }> = [];
    if (typeof ResizeObserver !== "undefined") {
      const containerSize = new ResizeObserver(resize);
      containerSize.observe(container);
      const rootSize = new ResizeObserver(measure);
      rootSize.observe(root);
      observers.push(containerSize, rootSize);
    }
    const mutation = new MutationObserver(measure);
    mutation.observe(root, { childList: true, subtree: true });
    observers.push(mutation);
    return () => observers.forEach((observer) => observer.disconnect());
  });
  return (
    <div ref={(element) => (outer = element)} sx={styles.viewport}>
      <div
        ref={(element) => (inner = element)}
        inert
        sx={styles.viewportInner}
        style={{
          width: `${size().width / scale()}px`,
          height: `${size().height / scale()}px`,
          transform: `scale(${scale()})`,
        }}
      >
        {props.children}
        <Show when={targetBox()}>
          {(box) => (
            <span
              sx={styles.target}
              style={{
                left: `${box().x}px`,
                top: `${box().y}px`,
                width: `${box().width}px`,
                height: `${box().height}px`,
              }}
            >
              <IconTablerPointerFilled {...stylex.attrs(styles.cursor, styles.cursorReveal)} />
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}

const noop = () => {};

const exampleSetupKey = "kD3vQm8Zr1pXw7NcY2tLh5sF0gJb9uAeE4oVi6nRk-c";

/** The server's first-run page, as it looks when opened from the setup link. */
export function ServerSetupPreview() {
  return (
    <ScaledViewport width={560} height={440} target="Continue with MacroGraph">
      <div sx={styles.serverPage}>
        <ServerSetupCard>
          <ServerSetupForm
            setupKey={exampleSetupKey}
            onSetupKeyInput={noop}
            showKeyInput={false}
            onSubmit={noop}
          />
        </ServerSetupCard>
      </div>
    </ScaledViewport>
  );
}

export const exampleUserCode = "BKTW-QHMR";

const exampleRequest: DeviceRequest = {
  userCode: exampleUserCode,
  client: { id: "example-server", name: "MacroGraph server on 7c2d9e41b8a3", verified: false },
  scope: ["openid", "email", "offline_access", "credentials"],
  requestedAt: 0,
  expiresAt: 0,
  requestIp: "203.0.113.24",
  requestCountry: null,
};

/** macrograph.app's approval page for the server's request. */
export function ApprovalPreview() {
  return (
    <ScaledViewport width={520} height={780} target="Approve">
      <div sx={styles.devicePage}>
        <DeviceAuthorizationLayout>
          <DeviceCard>
            <DeviceApproval
              email="you@example.com"
              request={exampleRequest}
              pending={false}
              onDecide={noop}
            />
          </DeviceCard>
        </DeviceAuthorizationLayout>
      </div>
    </ScaledViewport>
  );
}

const twitch = findPackage({ publisher: "macrograph", name: "twitch" });
const obs = findPackage({ publisher: "macrograph", name: "obs" });

/** A small graph built from the real Twitch and OBS schemas: a chat message switches scenes. */
const exampleGraph = (
  twitchPackage: Package.Model,
  obsPackage: Package.Model,
): RenderedGraph.Model | undefined => {
  const chat = twitchPackage.schemas.find((schema) => schema.id === "ChannelChatMessage");
  const scene = obsPackage.schemas.find((schema) => schema.id === "SetCurrentProgramScene");
  const chatOut = chat?.executionOutputs[0];
  const sceneIn = scene?.executionInputs[0];
  if (chat === undefined || scene === undefined || chatOut === undefined || sceneIn === undefined)
    return undefined;
  const sceneName = scene.dataInputs.find((input) => /scene/i.test(input.id));
  const node = (
    id: string,
    pkg: Package.Model,
    schema: Package.SchemaModel,
    position: { readonly x: number; readonly y: number },
    options: Pick<RenderedGraph.Node, "inputDefaults" | "foldPins">,
  ): RenderedGraph.Node => ({
    id: NodeId.make(id),
    name: schema.name,
    schema: { package: pkg.id, schema: schema.id },
    position,
    properties: {},
    ...options,
    io: {
      dataInputs: schema.dataInputs,
      dataOutputs: schema.dataOutputs,
      executionInputs: schema.executionInputs,
      executionOutputs: schema.executionOutputs,
    },
  });
  const chatNode = node(
    "chat",
    twitchPackage,
    chat,
    { x: 0, y: 40 },
    {
      inputDefaults: {},
      foldPins: true,
    },
  );
  const sceneNode = node(
    "scene",
    obsPackage,
    scene,
    { x: 320, y: 0 },
    {
      inputDefaults: sceneName === undefined ? {} : { [sceneName.id]: "Just Chatting" },
      foldPins: false,
    },
  );
  return {
    id: CanvasId.make("server-setup-example"),
    name: "Example",
    nodes: { [chatNode.id]: chatNode, [sceneNode.id]: sceneNode },
    connections: [
      {
        id: ConnectionId.make("chat-to-scene"),
        outNodeId: chatNode.id,
        outIo: { _tag: "Port", id: chatOut.id },
        inNodeId: sceneNode.id,
        inIoId: sceneIn.id,
      },
    ],
    schemas: {
      [twitchPackage.id]: { [chat.id]: chat },
      [obsPackage.id]: { [scene.id]: scene },
    },
  };
};

/** The server's editor once it's set up, with the real header and graph canvas. */
export function EditorPreview() {
  return (
    <ScaledViewport width={760} height={420}>
      <div sx={styles.serverApp}>
        <ServerHeader>
          <AccountMenu email="you@example.com" onSignOut={noop} />
        </ServerHeader>
        <div sx={styles.canvas}>
          <Show when={twitch !== undefined && obs !== undefined && { twitch, obs }}>
            {(found) => (
              // The modules load in the background; only the canvas waits for them.
              <Loading fallback={null}>
                <ExampleCanvas twitch={found().twitch.id} obs={found().obs.id} />
              </Loading>
            )}
          </Show>
        </div>
      </div>
    </ScaledViewport>
  );
}

function ExampleCanvas(props: { readonly twitch: ModuleId.Id; readonly obs: ModuleId.Id }) {
  const twitchReference = usePackageReference(() => props.twitch);
  const obsReference = usePackageReference(() => props.obs);
  const graph = createMemo(() => exampleGraph(twitchReference(), obsReference()));
  return <Show when={graph()}>{(current) => <SnapshotGraphCanvas graph={current()} />}</Show>;
}

/** How long each part of the approval flow shows before moving on. */
export const approvalFrameDuration = 3200;

export const serverTab: BrowserTab = { url: "localhost:3001" };
export const appTab: BrowserTab = { url: "macrograph.app/device", secure: true };

export type BrowserPage = "setup" | "approve" | "editor";

/** A page in the browser previews. Changing it swaps the page, as switching tabs does. */
export function BrowserPageView(props: { readonly page: BrowserPage }) {
  return (
    <Switch>
      <Match when={props.page === "setup"}>
        <div sx={styles.frame}>
          <ServerSetupPreview />
        </div>
      </Match>
      <Match when={props.page === "approve"}>
        <div sx={styles.frame}>
          <ApprovalPreview />
        </div>
      </Match>
      <Match when={props.page === "editor"}>
        <div sx={styles.frame}>
          <EditorPreview />
        </div>
      </Match>
    </Switch>
  );
}

const lineIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: 1, transform: "none" },
});

const tabIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateX(-6px)" },
  to: { opacity: 1, transform: "none" },
});

const frameIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const cursorIn = stylex.keyframes({
  from: { opacity: 0, transform: "translate(36px, 28px)" },
  to: { opacity: 1, transform: "none" },
});

const ring = stylex.keyframes({
  "0%": { boxShadow: `0 0 0 0 rgb(234 179 8 / 0.55)` },
  "70%": { boxShadow: `0 0 0 8px rgb(234 179 8 / 0)` },
  "100%": { boxShadow: `0 0 0 0 rgb(234 179 8 / 0)` },
});

const reducedMotion = "@media (prefers-reduced-motion: reduce)";
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

const styles = stylex.create({
  window: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    boxSizing: "border-box",
    margin: 0,
    minWidth: 0,
    overflow: "hidden",
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 10,
    boxShadow: "0 16px 40px rgb(0 0 0 / 0.35)",
  },
  terminal: { backgroundColor: "#0b0b0c" },
  browser: { backgroundColor: colors.gray1 },
  titleBar: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 36,
    paddingInline: 12,
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    backgroundColor: colors.gray2,
  },
  dots: { position: "absolute", left: 12, display: "flex", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 9999 },
  dotRed: { backgroundColor: "#ff5f57" },
  dotYellow: { backgroundColor: "#febc2e" },
  dotGreen: { backgroundColor: "#28c840" },
  terminalTitle: { fontSize: 12, fontWeight: 500, color: colors.gray10 },
  titleEnd: { position: "absolute", right: 8 },
  terminalBody: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    flex: 1,
    margin: 0,
    padding: 14,
    overflowY: "auto",
    fontFamily: mono,
    fontSize: 12,
    lineHeight: "19px",
    color: colors.gray12,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  lineGroup: { display: "flex", flexDirection: "column", gap: 2 },
  groupReveal: {
    animationName: frameIn,
    animationDuration: { default: "220ms", [reducedMotion]: "1ms" },
    animationTimingFunction: "ease-out",
  },
  line: { display: "block" },
  lineReveal: {
    animationName: lineIn,
    animationDuration: { default: "260ms", [reducedMotion]: "1ms" },
    animationDelay: { default: "calc(150ms + var(--line) * 160ms)", [reducedMotion]: "0ms" },
    animationFillMode: "both",
    animationTimingFunction: "ease-out",
  },
  prompt: { color: colors.pure, userSelect: "none" },
  output: { color: colors.gray10 },
  link: {
    color: colors.focus,
    textDecorationLine: "underline",
    textDecorationColor: "rgb(234 179 8 / 0.5)",
    textUnderlineOffset: 3,
  },
  copy: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 24,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 5,
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    color: { default: colors.gray10, ":hover": colors.gray12 },
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
  },
  copyIcon: { width: 13, height: 13 },
  browserBar: { justifyContent: "flex-start", paddingLeft: 66 },
  tabs: { display: "flex", gap: 4, minWidth: 0 },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    maxWidth: 200,
    height: 24,
    paddingInline: 10,
    borderRadius: 6,
    fontSize: 11,
    color: colors.gray10,
    whiteSpace: "nowrap",
    animationName: tabIn,
    animationDuration: { default: "200ms", [reducedMotion]: "1ms" },
    animationTimingFunction: "ease-out",
    transitionProperty: "background-color, color",
    transitionDuration: { default: "200ms", [reducedMotion]: "0ms" },
  },
  tabActive: { backgroundColor: colors.gray4, color: colors.gray12 },
  tabIcon: { flexShrink: 0, width: 12, height: 12, color: colors.gray9 },
  tabUrl: { overflow: "hidden", textOverflow: "ellipsis" },
  frame: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    animationName: frameIn,
    animationDuration: { default: "220ms", [reducedMotion]: "1ms" },
    animationTimingFunction: "ease-out",
  },
  browserBody: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    userSelect: "none",
  },
  viewport: { position: "relative", flex: 1, minHeight: 0, overflow: "hidden" },
  viewportInner: {
    position: "absolute",
    top: 0,
    left: 0,
    display: "flex",
    flexDirection: "column",
    transformOrigin: "0 0",
    backgroundColor: colors.gray1,
    color: colors.gray12,
    fontSize: 14,
  },
  // Mirrors each page's own frame, which is sized to the browser window rather than its content.
  serverPage: { display: "flex", flex: 1, minHeight: 0, padding: 24 },
  devicePage: { display: "grid", flex: 1, placeItems: "center", padding: 24 },
  serverApp: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  canvas: { display: "flex", flex: 1, minHeight: 0 },
  target: {
    position: "absolute",
    borderRadius: 8,
    pointerEvents: "none",
    animationName: { default: ring, [reducedMotion]: "none" },
    animationDuration: "1.8s",
    animationIterationCount: "infinite",
    boxShadow: { default: null, [reducedMotion]: `0 0 0 3px ${colors.focus}` },
  },
  cursor: {
    position: "absolute",
    right: "18%",
    bottom: -18,
    width: 30,
    height: 30,
    color: colors.gray12,
    filter: "drop-shadow(0 1px 3px rgb(0 0 0 / 0.7))",
  },
  cursorReveal: {
    animationName: cursorIn,
    animationDuration: { default: "600ms", [reducedMotion]: "1ms" },
    animationDelay: { default: "350ms", [reducedMotion]: "0ms" },
    animationFillMode: "both",
    animationTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  },
});
