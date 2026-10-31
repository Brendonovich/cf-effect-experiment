import { AccountMenu, ButtonLink, macrographLogo } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";

import { loginPath } from "./api";
import { useLogOut, useSession } from "./session";

export function Header() {
  const session = useSession();
  const logOut = useLogOut();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header sx={styles.header}>
      <a href="/" sx={[styles.brand]}>
        <img src={macrographLogo} alt="" sx={styles.logo} />
        MacroGraph
      </a>
      <div sx={styles.end}>
        <Show when={!session.isPending} fallback={<span sx={styles.placeholder} />}>
          <Show
            when={session.data}
            fallback={
              <ButtonLink
                href={loginPath(`${location.pathname}${location.search}`)}
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

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    height: 56,
    paddingInline: 20,
    borderBottomColor: colors.gray4,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: colors.gray12,
    textDecoration: "none",
  },
  logo: { width: 28, height: 28, borderRadius: 6 },
  end: { display: "flex", alignItems: "center", gap: 16 },
  login: { borderRadius: 6 },
  placeholder: {
    width: 28,
    height: 28,
    borderRadius: 9999,
    backgroundColor: colors.gray4,
  },
});
