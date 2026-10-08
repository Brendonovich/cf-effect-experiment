import type { Presence } from "@macrograph/editor";

import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import type { createEditorStore } from "../store";
import type { WorkspaceTab } from "../workspace/workspace";
import type { EditorActivity } from "./createEditorActivity";
import type { CanvasSize } from "./createEditorPresence";

import { clientName } from "../../presence/presenceGroups";

type Point = { readonly x: number; readonly y: number };
type View = { readonly origin: Point; readonly scale: number };

const minScale = 0.25;
const maxScale = 2;
const noticeMs = 4000;

export interface FollowNotice {
  readonly name: string;
  readonly color: string;
  readonly message: string;
}

/** Where to look when following a client: a shared viewport, or a single point to centre on. */
export type FollowTarget =
  | { readonly graphId: string; readonly viewport: Presence.Viewport }
  | { readonly graphId: string; readonly point: Point | null };

/**
 * Browser clients share their viewport and cursor. Other actors (API and MCP callers) have
 * neither, so following them means jumping to their most recent edit.
 */
export const followTarget = (
  client: Presence.Client,
  lastEdit: EditorActivity["lastEdit"],
): FollowTarget | null => {
  if (client.kind === "browser") {
    if (client.activeGraph === null) return null;
    return client.viewport !== null
      ? { graphId: client.activeGraph, viewport: client.viewport }
      : { graphId: client.activeGraph, point: client.cursor };
  }
  const edit = lastEdit(client.id);
  if (edit !== undefined) return { graphId: edit.graphId, point: edit.position };
  return client.activeGraph === null ? null : { graphId: client.activeGraph, point: client.cursor };
};

const clampScale = (scale: number) => Math.min(maxScale, Math.max(minScale, scale));

/** The local view that shows a follow target on a canvas of the given size. */
export const viewForTarget = (
  target: FollowTarget,
  size: CanvasSize | null,
  current: View,
): View | null => {
  if ("viewport" in target) {
    const { viewport } = target;
    if (size === null) return { origin: { x: viewport.x, y: viewport.y }, scale: current.scale };
    const scale = clampScale(Math.min(size.width / viewport.width, size.height / viewport.height));
    return {
      origin: {
        x: viewport.x + viewport.width / 2 - size.width / 2 / scale,
        y: viewport.y + viewport.height / 2 - size.height / 2 / scale,
      },
      scale,
    };
  }
  if (target.point === null) return null;
  const halfWidth = size === null ? 0 : size.width / 2 / current.scale;
  const halfHeight = size === null ? 0 : size.height / 2 / current.scale;
  return {
    origin: { x: target.point.x - halfWidth, y: target.point.y - halfHeight },
    scale: current.scale,
  };
};

const sameView = (left: View, right: View) =>
  Math.abs(left.scale - right.scale) < 1e-6 &&
  Math.abs(left.origin.x - right.origin.x) < 1e-3 &&
  Math.abs(left.origin.y - right.origin.y) < 1e-3;

/**
 * Follows another client: shows the graph they are viewing and keeps the viewport on them. Any
 * navigation the follower makes themselves (pan, zoom, or opening something else) stops following.
 */
export function createEditorFollow(options: {
  editor: ReturnType<typeof createEditorStore>;
  presenceClients: () => ReadonlyArray<Presence.Client>;
  selfId: () => string | undefined;
  activity: EditorActivity;
  canvasSize: () => CanvasSize | null;
  layout: {
    readonly activeWorkspaceView: () => WorkspaceTab | { readonly type: "empty" };
    readonly selectedGraphId: () => string | null;
    readonly setSelectedGraphId: (graphId: string | null) => void;
    readonly canvasOrigin: () => Point;
    readonly setCanvasOrigin: (origin: Point) => void;
    readonly canvasScale: () => number;
    readonly setCanvasScale: (scale: number) => void;
  };
}) {
  const { layout } = options;
  const { store } = options.editor;
  const [followingId, setFollowingId] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<FollowNotice | null>(null);
  const followed = createMemo(() => {
    const id = followingId();
    return id === null ? undefined : options.presenceClients().find((client) => client.id === id);
  });

  // The location this follower last moved to; anything else means the user navigated themselves.
  let expected: { graphId: string; view: View | null } | null = null;
  let pending: { graphId: string; from: string | null } | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFollowed: Presence.Client | undefined;

  const currentGraphId = () =>
    layout.activeWorkspaceView().type === "graph" ? layout.selectedGraphId() : null;

  const showNotice = (value: FollowNotice | null) => {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    noticeTimer = undefined;
    setNotice(value);
    if (value !== null) noticeTimer = setTimeout(() => setNotice(null), noticeMs);
  };

  const stop = () => {
    expected = null;
    pending = null;
    setFollowingId(null);
  };

  const follow = (clientId: string) => {
    if (clientId === untrack(options.selfId)) return;
    expected = null;
    pending = null;
    showNotice(null);
    setFollowingId(clientId);
  };

  const applyView = (view: View) => {
    layout.setCanvasScale(view.scale);
    layout.setCanvasOrigin(view.origin);
  };

  // Runs untracked: it reads the current view and navigates the workspace.
  const moveTo = (target: FollowTarget) => {
    const graphId = currentGraphId();
    const current = { origin: layout.canvasOrigin(), scale: layout.canvasScale() };
    const view = viewForTarget(target, options.canvasSize(), current);
    if (pending?.graphId === target.graphId) {
      // Still opening this graph; the view is applied once it has opened.
      expected = { graphId: target.graphId, view };
      return;
    }
    if (graphId !== target.graphId) {
      expected = { graphId: target.graphId, view };
      pending = { graphId: target.graphId, from: graphId };
      layout.setSelectedGraphId(target.graphId);
      return;
    }
    expected = { graphId: target.graphId, view: view ?? current };
    if (view !== null && !sameView(view, current)) applyView(view);
  };

  createEffect(
    () => {
      const id = followingId();
      if (id === null) return { status: "idle" as const };
      const client = followed();
      if (client === undefined) return { status: "missing" as const };
      const target = followTarget(client, options.activity.lastEdit);
      // Wait for the graph to exist locally, e.g. one the followed client just created.
      if (target === null || store.project?.graphs[target.graphId] === undefined)
        return { status: "waiting" as const, client };
      return { status: "target" as const, client, target, size: options.canvasSize() };
    },
    (state) => {
      if (state.status === "idle") return;
      if (state.status === "missing") {
        const last = lastFollowed;
        stop();
        if (last !== undefined)
          showNotice(
            last.kind === "browser"
              ? { name: last.displayName, color: last.color, message: "left the project" }
              : { name: clientName(last), color: last.color, message: "is no longer active" },
          );
        return;
      }
      lastFollowed = state.client;
      if (state.status === "target") untrack(() => moveTo(state.target));
    },
  );

  createEffect(
    () => ({
      graphId: currentGraphId(),
      view: { origin: layout.canvasOrigin(), scale: layout.canvasScale() },
    }),
    ({ graphId, view }) => {
      if (untrack(followingId) === null || expected === null) return;
      if (pending !== null) {
        if (graphId === pending.from) return;
        if (graphId !== pending.graphId) return stop();
        // Opening the graph restores its saved view, so apply the followed view afterwards.
        pending = null;
        if (expected.view === null) expected = { graphId, view };
        else if (!sameView(expected.view, view)) applyView(expected.view);
        return;
      }
      if (
        graphId !== expected.graphId ||
        (expected.view !== null && !sameView(expected.view, view))
      )
        stop();
    },
  );

  createEffect(followingId, (id) => {
    if (id === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      stop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  onCleanup(() => {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
  });

  return { followingId, followed, follow, stop, notice, dismissNotice: () => showNotice(null) };
}

export type EditorFollow = ReturnType<typeof createEditorFollow>;
