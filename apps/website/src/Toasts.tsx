import type { JSX } from "@solidjs/web";

import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { For, Show, createSignal } from "solid-js";

export type ToastTone = "info" | "success" | "error";

interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly content: JSX.Element;
  readonly actions?: ReadonlyArray<{ readonly label: string; readonly onClick: () => void }>;
}

const [toasts, setToasts] = createSignal<ReadonlyArray<Toast>>([]);
let nextId = 0;

export const dismissToast = (id: number) =>
  setToasts((current) => current.filter((toast) => toast.id !== id));

/** Shows a toast. Toasts without actions dismiss themselves after a few seconds. */
export function showToast(toast: Omit<Toast, "id">) {
  const id = nextId++;
  setToasts((current) => [...current, { ...toast, id }]);
  if (toast.actions === undefined) window.setTimeout(() => dismissToast(id), 5_000);
  return id;
}

export function Toaster() {
  return (
    <div sx={styles.region} role="status" aria-live="polite">
      <For each={toasts()}>
        {(toast) => (
          <div sx={[styles.toast, toast.tone === "error" && styles.error]}>
            <span
              sx={[
                styles.dot,
                toast.tone === "success" && styles.dotSuccess,
                toast.tone === "error" && styles.dotError,
              ]}
            />
            <div sx={styles.body}>
              <div>{toast.content}</div>
              <Show when={toast.actions}>
                {(actions) => (
                  <div sx={styles.actions}>
                    <For each={actions()}>
                      {(action, index) => (
                        <button
                          type="button"
                          sx={[styles.action, index() === 0 && styles.primaryAction]}
                          onClick={() => {
                            action.onClick();
                            dismissToast(toast.id);
                          }}
                        >
                          {action.label}
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            </div>
            <button
              type="button"
              sx={styles.close}
              aria-label="Dismiss"
              onClick={() => dismissToast(toast.id)}
            >
              <IconBiX {...stylex.attrs(styles.closeIcon)} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}

const styles = stylex.create({
  region: {
    position: "fixed",
    right: 16,
    bottom: 16,
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: "min(360px, calc(100vw - 32px))",
  },
  toast: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    paddingBlock: 12,
    paddingInline: 14,
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: colors.gray3,
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
    fontSize: 13,
    lineHeight: "20px",
    color: colors.gray12,
  },
  error: { borderColor: colors.red6 },
  dot: {
    flexShrink: 0,
    width: 8,
    height: 8,
    marginTop: 6,
    borderRadius: 9999,
    backgroundColor: "#60a5fa",
  },
  dotSuccess: { backgroundColor: "#3dd68c" },
  dotError: { backgroundColor: colors.red9 },
  body: { flex: 1, minWidth: 0 },
  actions: { display: "flex", gap: 8, marginTop: 10 },
  action: {
    height: 28,
    paddingInline: 10,
    borderColor: colors.gray6,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    fontSize: 12,
    fontWeight: 500,
    color: colors.gray12,
    cursor: "pointer",
  },
  primaryAction: {
    borderColor: colors.gray12,
    backgroundColor: { default: colors.gray12, ":hover": colors.gray11 },
    color: colors.gray1,
  },
  close: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 20,
    height: 20,
    border: 0,
    borderRadius: 4,
    backgroundColor: { default: "transparent", ":hover": colors.gray5 },
    color: colors.gray10,
    cursor: "pointer",
  },
  closeIcon: { width: 14, height: 14 },
});
