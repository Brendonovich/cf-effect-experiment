import type { EditorSettingsContext } from "@macrograph/editor-ui";

import { ButtonLink, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { Show } from "solid-js";

import { loginPath } from "../api";
import { CredentialsRoute } from "../routes/Credentials";
import { useSession } from "../session";

/**
 * The playground's project settings: the credentials of the account signed in to the website,
 * which its modules use. Changes here reach the running modules straight away.
 */
export function PlaygroundCredentials(props: {
  readonly client: EditorSettingsContext["client"];
  readonly onChanged: EditorSettingsContext["refreshModuleData"];
}) {
  const session = useSession();
  const reload = async () => {
    const client = props.client();
    if (client !== null) await Effect.runPromise(client.RefetchCredentials());
    await props.onChanged();
  };

  return (
    <section sx={styles.section}>
      <Show
        when={!session.isPending}
        fallback={<LoadingState label="Checking your session" style={styles.loading} />}
      >
        <Show
          when={session.data}
          fallback={
            <>
              <h3 sx={styles.heading}>Credentials</h3>
              <p sx={styles.description}>
                Log in to use the credentials connected to your MacroGraph account.
              </p>
              <ButtonLink href={loginPath("/playground")} size="sm">
                Log in
              </ButtonLink>
            </>
          }
        >
          <CredentialsRoute onChanged={reload} />
        </Show>
      </Show>
    </section>
  );
}

const styles = stylex.create({
  section: { boxSizing: "border-box", width: "100%", maxWidth: 672, padding: 12, fontSize: 14 },
  heading: { margin: 0, fontSize: 14, fontWeight: 600, color: colors.gray12 },
  description: { marginBlock: "4px 12px", fontSize: 12, lineHeight: "20px", color: colors.gray11 },
  loading: { height: 120 },
});
