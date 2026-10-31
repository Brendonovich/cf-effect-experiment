import type { JSX } from "@solidjs/web";

import { AccountMenu, ButtonLink, macrographLogo } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { For, Show } from "solid-js";

import { loginPath } from "./api";
import { useLogOut, useSession } from "./session";

const siteLinks = [
  { href: "/playground", label: "Playground" },
  { href: "/modules", label: "Modules" },
  { href: "/docs", label: "Docs" },
] as const;

/** The site header. Pages can add a centered `nav` and `actions` beside the account menu. */
export function Header(props: { readonly nav?: JSX.Element; readonly actions?: JSX.Element }) {
  const session = useSession();
  const logOut = useLogOut();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header sx={styles.header}>
      <div sx={styles.start}>
        <a href="/" sx={[styles.brand]}>
          <img src={macrographLogo} alt="" sx={styles.logo} />
          MacroGraph
        </a>
        <nav sx={styles.links} aria-label="Site">
          <For each={siteLinks}>
            {(link) => {
              const current = () => location.pathname === link.href;
              const active = () => current() || location.pathname.startsWith(`${link.href}/`);
              return (
                <a
                  href={link.href}
                  sx={[styles.link, active() && styles.linkActive]}
                  aria-current={current() ? "page" : undefined}
                >
                  {link.label}
                </a>
              );
            }}
          </For>
        </nav>
      </div>
      <Show when={props.nav !== undefined}>
        <div sx={styles.nav}>{props.nav}</div>
      </Show>
      <div sx={styles.end}>
        {props.actions}
        <Show when={!session.isPending} fallback={<span sx={styles.placeholder} />}>
          <Show
            when={session.data}
            fallback={
              <ButtonLink
                href={loginPath(`${location.pathname}${location.search}`)}
                size="sm"
                variant="secondary"
                sx={styles.login}
              >
                Log in
              </ButtonLink>
            }
          >
            {(current) => (
              <AccountMenu
                email={current().user.email}
                items={[
                  { label: "Credentials", onSelect: () => navigate("/account/credentials") },
                  { label: "Sign-in methods", onSelect: () => navigate("/account/sign-in") },
                  { label: "Apps", onSelect: () => navigate("/account/apps") },
                ]}
                onSignOut={() => logOut.mutate()}
              />
            )}
          </Show>
        </Show>
      </div>
    </header>
  );
}

const md = "@media (min-width: 768px)";
const styles = stylex.create({
  header: {
    display: "grid",
    gridTemplateColumns: { default: "auto minmax(0, 1fr)", [md]: "1fr auto 1fr" },
    // Every page's header row is the same height; `nav` wraps onto its own row on narrow screens.
    gridTemplateRows: "minmax(44px, auto)",
    alignItems: "center",
    columnGap: 12,
    paddingInline: 12,
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  start: { display: "flex", alignItems: "center", gap: 16, minWidth: 0 },
  links: { display: "flex", alignItems: "center", gap: 12 },
  link: {
    fontSize: 13,
    fontWeight: 500,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    textDecoration: "none",
  },
  linkActive: { color: colors.gray12 },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: colors.gray12,
    textDecoration: "none",
  },
  logo: { width: 24, height: 24, borderRadius: 5 },
  nav: {
    display: "flex",
    alignSelf: "stretch",
    justifySelf: "center",
    gridColumn: { default: "1 / -1", [md]: "2" },
    gridRow: { default: "2", [md]: "1" },
  },
  end: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    gridColumn: "-2",
    gridRow: "1",
    minWidth: 0,
  },
  login: { borderRadius: 6 },
  placeholder: {
    width: 24,
    height: 24,
    borderRadius: 9999,
    backgroundColor: colors.gray4,
  },
});
