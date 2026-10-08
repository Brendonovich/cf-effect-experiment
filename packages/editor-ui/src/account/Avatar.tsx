import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, Loading, Show } from "solid-js";

import { colors } from "../tokens.stylex.ts";

export interface AvatarProps {
  /** Shows the Gravatar for this address; without one, initials of `name` are shown instead. */
  readonly email?: string | null | undefined;
  readonly name?: string | undefined;
  /** Background for the initials variant. */
  readonly color?: string | undefined;
  readonly size?: number | undefined;
  readonly style?: stylex.StyleXStyles;
}

const gravatarUrl = async (email: string) => {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const url = new URL(`https://gravatar.com/avatar/${hash}`);
  url.searchParams.set("s", "80");
  url.searchParams.set("d", "initials");
  url.searchParams.set("name", normalized.split("@", 1)[0] ?? normalized);
  return url.href;
};

export const avatarInitials = (name: string) => {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter((word) => word.length > 0);
  const initials =
    words.length > 1 ? `${words[0]!.slice(0, 1)}${words[1]!.slice(0, 1)}` : (words[0] ?? "");
  return initials.slice(0, 2).toUpperCase() || "?";
};

export function Avatar(props: AvatarProps) {
  const email = createMemo(() => {
    const value = props.email?.trim();
    return value === undefined || value.length === 0 ? null : value;
  });
  const initials = () => avatarInitials(props.name ?? email()?.split("@", 1)[0] ?? "");

  return (
    <span
      sx={[styles.root, props.color !== undefined && styles.colored, props.style]}
      style={{
        "background-color": props.color,
        width: props.size === undefined ? undefined : `${props.size}px`,
        height: props.size === undefined ? undefined : `${props.size}px`,
        "font-size": props.size === undefined ? undefined : `${Math.round(props.size * 0.4)}px`,
      }}
      data-avatar-variant={email() === null ? "initials" : "gravatar"}
    >
      <Show when={email()} keyed fallback={initials()}>
        {(address) => <GravatarImage email={address} fallback={initials()} />}
      </Show>
    </span>
  );
}

function GravatarImage(props: { readonly email: string; readonly fallback: string }) {
  const source = createMemo(() => gravatarUrl(props.email));
  // Offline or blocked image requests fall back to initials instead of an empty circle.
  const [failed, setFailed] = createSignal(false);
  return (
    <Show when={!failed()} fallback={props.fallback}>
      <Loading fallback={props.fallback}>
        <img
          src={source()}
          alt=""
          style={{ height: "100%", "object-fit": "cover", width: "100%" }}
          referrerpolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </Loading>
    </Show>
  );
}

const styles = stylex.create({
  root: {
    alignItems: "center",
    backgroundColor: colors.gray4,
    borderRadius: "50%",
    color: colors.gray11,
    display: "inline-grid",
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 600,
    height: 24,
    justifyItems: "center",
    overflow: "hidden",
    width: 24,
  },
  colored: { color: "white", textShadow: "0 1px 1px rgb(0 0 0 / 0.35)" },
});
