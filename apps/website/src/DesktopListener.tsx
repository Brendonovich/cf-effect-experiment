import { createEffect, onCleanup } from "solid-js";

import { useSession } from "./session";
import { showToast } from "./Toasts";

/** The local server MacroGraph Desktop listens on while waiting for a website login. */
const desktopOrigin = "http://localhost:25000";

const desktopRunning = async () => {
  try {
    const response = await fetch(desktopOrigin, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Offers to sign MacroGraph Desktop in with the current website session when the desktop app is
 * running on this machine. Asks at most once per page load.
 */
export function DesktopListener() {
  const session = useSession();
  let prompted = false;

  const check = async () => {
    const current = session.data;
    if (prompted || current === null || current === undefined) return;
    if (!(await desktopRunning()) || prompted) return;
    prompted = true;
    showToast({
      tone: "info",
      content: (
        <>
          <strong>MacroGraph Desktop</strong> detected. Log in as{" "}
          <strong>{current.user.email}</strong>?
        </>
      ),
      actions: [
        {
          label: "Log in",
          onClick: () =>
            void fetch(`${desktopOrigin}/session`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(current.session.id),
            }).then(
              () =>
                showToast({
                  tone: "success",
                  content: (
                    <>
                      Logged in. Head to <strong>MacroGraph Desktop</strong>.
                    </>
                  ),
                }),
              () => showToast({ tone: "error", content: "Could not reach MacroGraph Desktop." }),
            ),
        },
        { label: "Not now", onClick: () => {} },
      ],
    });
  };

  createEffect(
    () => session.data,
    () => void check(),
  );
  const onFocus = () => void check();
  window.addEventListener("focus", onFocus);
  onCleanup(() => window.removeEventListener("focus", onFocus));

  return null;
}
