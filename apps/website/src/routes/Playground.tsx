import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { clientOnly } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";

import { Header } from "../Header";

// The playground runs entirely in the browser, on local storage, so it is never server-rendered.
// Checking `SSR` also keeps its code out of the server bundle.
const Playground = clientOnly(
  () => (import.meta.env.SSR ? new Promise<never>(() => {}) : import("../playground/Playground")),
  { export: "Playground", lazy: true },
);

export function PlaygroundRoute() {
  return (
    <Playground
      fallback={
        <div sx={styles.fallback}>
          <Header />
        </div>
      }
    />
  );
}

const styles = stylex.create({
  fallback: { height: "100vh", backgroundColor: colors.gray1 },
});
