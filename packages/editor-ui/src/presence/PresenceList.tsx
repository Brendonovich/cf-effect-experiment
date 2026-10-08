import type { Presence } from "@macrograph/editor";

import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import type { EditorController } from "../editor/createEditorController";

import { Avatar } from "../account/Avatar.tsx";
import { colors } from "../tokens.stylex.ts";
import {
  clientName,
  followCandidate,
  groupPresence,
  type PresenceGroup,
} from "./presenceGroups.ts";
import { createNow, presenceOpacity } from "./presenceTime.ts";

export interface PresenceListProps {
  readonly controller: {
    readonly connection: Pick<EditorController["connection"], "presenceClients" | "selfId">;
    readonly follow: Pick<EditorController["follow"], "followingId" | "follow" | "stop">;
  };
  /** Called when following starts, so a host can bring the editor into view. */
  readonly onFollow?: () => void;
  /** Avatars shown before the rest collapse into a "+N" badge. */
  readonly max?: number;
}

const kindLabels: Record<Presence.Client["kind"], string> = {
  browser: "Browser",
  api: "API",
  mcp: "MCP",
};

function KindIcon(props: {
  readonly kind: Presence.Client["kind"];
  readonly style?: stylex.StyleXStyles;
}) {
  const attrs = () => stylex.attrs(styles.kindIcon, props.style);
  return (
    <Show
      when={props.kind === "browser"}
      fallback={
        <Show
          when={props.kind === "mcp"}
          fallback={<IconTablerPlug {...attrs()} aria-hidden="true" />}
        >
          <IconTablerRobot {...attrs()} aria-hidden="true" />
        </Show>
      }
    >
      <IconTablerBrowser {...attrs()} aria-hidden="true" />
    </Show>
  );
}

/** How a REST or MCP client is described, e.g. "Claude Desktop 1.2.3 · MCP · key CI". */
const remoteDescription = (client: Presence.Client) => {
  const version = client.remote?.version ?? null;
  const apiKeyName = client.remote?.apiKeyName ?? null;
  return [
    version === null ? clientName(client) : `${clientName(client)} ${version}`,
    kindLabels[client.kind],
    ...(apiKeyName === null ? [] : [`key "${apiKeyName}"`]),
  ].join(" · ");
};

/** Shows who else is connected to the project, grouped by person, and lets you follow them. */
export function PresenceList(props: PresenceListProps) {
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  const groups = createMemo(() =>
    groupPresence(
      props.controller.connection.presenceClients(),
      props.controller.connection.selfId(),
    ),
  );
  const max = () => props.max ?? 4;
  const stacked = createMemo(() => groups().slice(0, max()));
  const overflow = () => Math.max(0, groups().length - max());
  const followingId = () => props.controller.follow.followingId();
  const isFollowingGroup = (group: PresenceGroup) =>
    group.clients.some((client) => client.id === followingId());
  // Remote entries fade before they expire.
  const now = createNow(() =>
    props.controller.connection.presenceClients().some((client) => client.expiresAt !== null),
  );

  const toggleFollow = (client: Presence.Client | undefined) => {
    if (client === undefined) return;
    if (client.id === followingId()) {
      props.controller.follow.stop();
    } else {
      props.controller.follow.follow(client.id);
      props.onFollow?.();
    }
    setOpen(false);
  };

  const toggleFollowGroup = (group: PresenceGroup) => {
    if (isFollowingGroup(group)) {
      props.controller.follow.stop();
      setOpen(false);
    } else {
      toggleFollow(followCandidate(group));
    }
  };

  createEffect(open, (isOpen) => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof globalThis.Node && !root?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger?.focus();
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  });

  const AgentRow = (rowProps: {
    readonly group: PresenceGroup;
    readonly client: Presence.Client;
  }) => {
    const isFollowed = () => rowProps.client.id === followingId();
    return (
      <li sx={styles.agentItem}>
        <button
          type="button"
          sx={[styles.agentRow, isFollowed() && styles.followed]}
          style={{
            "--presence-color": rowProps.group.color,
            opacity: presenceOpacity(rowProps.client, now()),
          }}
          title={remoteDescription(rowProps.client)}
          aria-pressed={isFollowed() ? "true" : "false"}
          aria-label={`${isFollowed() ? "Stop following" : "Follow"} ${clientName(rowProps.client)}`}
          onClick={() => toggleFollow(rowProps.client)}
          data-presence-client={rowProps.client.id}
          data-presence-kind={rowProps.client.kind}
        >
          <KindIcon kind={rowProps.client.kind} />
          <span sx={[styles.agentName, styles.truncate]} data-presence-client-name="">
            {clientName(rowProps.client)}
          </span>
          <span sx={styles.kindTag}>{kindLabels[rowProps.client.kind]}</span>
          <Show when={isFollowed()}>
            <span sx={styles.followingTag}>Following</span>
          </Show>
        </button>
      </li>
    );
  };

  return (
    <div
      ref={root}
      sx={styles.root}
      onFocusOut={(event) => {
        if (
          !(event.relatedTarget instanceof globalThis.Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <Show when={groups().length > 0}>
        <button
          ref={trigger}
          type="button"
          sx={styles.trigger}
          aria-label={`${groups().length} ${groups().length === 1 ? "person" : "people"} connected`}
          aria-expanded={open() ? "true" : "false"}
          aria-controls="presence-popover"
          onClick={() => setOpen((value) => !value)}
          data-presence-trigger=""
        >
          <For each={stacked()} keyed={(group) => group.key}>
            {(group, index) => (
              <span
                sx={[styles.stackItem, isFollowingGroup(group()) && styles.stackItemFollowed]}
                // Earlier avatars overlap later ones, so agent badges are not hidden.
                style={{
                  "--presence-color": group().color,
                  opacity: Math.max(
                    ...group().clients.map((client) => presenceOpacity(client, now())),
                  ),
                  "z-index": stacked().length - index(),
                }}
                title={[
                  group().displayName,
                  ...group().remote.map(
                    (client) => `${clientName(client)} (${kindLabels[client.kind]})`,
                  ),
                ].join(" · ")}
                data-presence-stack={group().key}
                data-presence-following={isFollowingGroup(group()) ? "" : undefined}
              >
                <Avatar
                  email={group().email}
                  name={group().displayName}
                  color={group().color}
                  size={24}
                />
                <Show when={group().remote[0]}>
                  {(agent) => (
                    <span
                      sx={styles.agentBadge}
                      data-presence-agent-badge={agent().kind}
                      aria-hidden="true"
                    >
                      <KindIcon kind={agent().kind} style={styles.agentBadgeIcon} />
                    </span>
                  )}
                </Show>
              </span>
            )}
          </For>
          <Show when={overflow() > 0}>
            <span sx={[styles.stackItem, styles.overflow]}>+{overflow()}</span>
          </Show>
        </button>
      </Show>
      <Show when={open()}>
        <div id="presence-popover" role="region" aria-label="Connected people" sx={styles.popover}>
          <div sx={styles.heading}>In this project · {groups().length}</div>
          <ul sx={styles.groups}>
            <For each={groups()} keyed={(group) => group.key}>
              {(group) => {
                const following = () => isFollowingGroup(group());
                // A person's own row stands for their browser; agents have rows of their own.
                const followedByPerson = () =>
                  group().clients.some(
                    (client) => client.kind === "browser" && client.id === followingId(),
                  );
                return (
                  <li sx={styles.group} data-presence-group={group().key}>
                    <button
                      type="button"
                      sx={[styles.person, followedByPerson() && styles.followed]}
                      style={{ "--presence-color": group().color }}
                      aria-pressed={following() ? "true" : "false"}
                      aria-label={`${following() ? "Stop following" : "Follow"} ${group().displayName}`}
                      onClick={() => toggleFollowGroup(group())}
                      data-presence-person=""
                    >
                      <span sx={[styles.avatarRing, following() && styles.avatarRingFollowed]}>
                        <Avatar
                          email={group().email}
                          name={group().displayName}
                          color={group().color}
                          size={28}
                        />
                      </span>
                      <span sx={styles.personName}>
                        <span sx={styles.truncate}>{group().displayName}</span>
                        <Show when={group().isSelf}>
                          <span sx={styles.you}>(you)</span>
                        </Show>
                      </span>
                      <Show when={followedByPerson()}>
                        <span sx={styles.followingTag}>Following</span>
                      </Show>
                      <Show when={!group().canEdit}>
                        <span sx={styles.badge}>Read only</span>
                      </Show>
                    </button>
                    <Show when={group().remote.length > 0}>
                      <ul sx={styles.agents}>
                        <For each={group().remote} keyed={(client) => client.id}>
                          {(client) => <AgentRow group={group()} client={client()} />}
                        </For>
                      </ul>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}

const styles = stylex.create({
  root: { position: "relative", display: "flex", alignItems: "center", minWidth: 0 },
  trigger: {
    display: "flex",
    alignItems: "center",
    minHeight: 32,
    borderRadius: 6,
    paddingBlock: 4,
    paddingInlineStart: 10,
    paddingInlineEnd: 6,
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    cursor: "pointer",
  },
  stackItem: {
    position: "relative",
    display: "grid",
    marginInlineStart: -6,
    borderRadius: "50%",
    boxShadow: `0 0 0 2px ${colors.gray2}, 0 0 0 3px var(--presence-color, ${colors.gray6})`,
  },
  stackItemFollowed: {
    boxShadow: `0 0 0 2px ${colors.gray2}, 0 0 0 4px var(--presence-color), 0 0 10px 3px color-mix(in srgb, var(--presence-color) 45%, transparent)`,
  },
  agentBadge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    display: "grid",
    width: 13,
    height: 13,
    placeItems: "center",
    borderRadius: "50%",
    backgroundColor: "var(--presence-color)",
    boxShadow: `0 0 0 1.5px ${colors.gray2}`,
  },
  agentBadgeIcon: { width: 9, height: 9, color: "white" },
  overflow: {
    width: 24,
    height: 24,
    placeItems: "center",
    backgroundColor: colors.gray4,
    fontSize: 10,
    fontWeight: 600,
    color: colors.gray11,
  },
  popover: {
    position: "absolute",
    zIndex: 50,
    top: "calc(100% + 6px)",
    right: 0,
    width: 260,
    maxHeight: "min(480px, calc(100vh - 80px))",
    overflowY: "auto",
    padding: 6,
    borderRadius: 8,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray2,
    boxShadow: "0 12px 24px rgb(0 0 0 / .25)",
    color: colors.gray12,
  },
  heading: {
    paddingBlock: 4,
    paddingInline: 6,
    fontSize: 11,
    fontWeight: 500,
    color: colors.gray10,
  },
  groups: { display: "flex", flexDirection: "column", gap: 2, margin: 0, padding: 0 },
  group: { listStyle: "none" },
  person: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: 8,
    borderRadius: 6,
    padding: 6,
    textAlign: "left",
    color: "inherit",
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    cursor: "pointer",
  },
  followed: {
    backgroundColor: {
      default: "color-mix(in srgb, var(--presence-color) 18%, transparent)",
      ":hover": "color-mix(in srgb, var(--presence-color) 26%, transparent)",
    },
  },
  avatarRing: { display: "grid", flexShrink: 0, borderRadius: "50%" },
  avatarRingFollowed: {
    boxShadow: `0 0 0 2px ${colors.gray2}, 0 0 0 4px var(--presence-color)`,
  },
  personName: {
    display: "flex",
    minWidth: 0,
    flex: 1,
    alignItems: "baseline",
    gap: 4,
    fontSize: 13,
  },
  you: { flexShrink: 0, fontSize: 11, color: colors.gray10 },
  truncate: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  badge: {
    flexShrink: 0,
    borderRadius: 4,
    border: `1px solid ${colors.gray6}`,
    paddingBlock: 1,
    paddingInline: 5,
    fontSize: 10,
    fontWeight: 500,
    color: colors.gray10,
  },
  followingTag: {
    flexShrink: 0,
    borderRadius: 4,
    paddingBlock: 1,
    paddingInline: 5,
    fontSize: 10,
    fontWeight: 600,
    color: "white",
    backgroundColor: "var(--presence-color)",
  },
  agents: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: 36,
    paddingInlineEnd: 0,
  },
  agentItem: { listStyle: "none" },
  agentRow: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: 6,
    minHeight: 26,
    borderRadius: 6,
    paddingInline: 6,
    textAlign: "left",
    fontSize: 12,
    color: colors.gray12,
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    cursor: "pointer",
    transition: "opacity 1s linear",
  },
  kindIcon: { width: 14, height: 14, flexShrink: 0, color: colors.gray10 },
  agentName: { flex: 1 },
  kindTag: { flexShrink: 0, fontSize: 10, fontWeight: 500, color: colors.gray10 },
});
