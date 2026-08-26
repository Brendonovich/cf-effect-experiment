import type { Package } from "@macrograph/core";
import type { ClientSettings } from "@macrograph/plugin";
import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";
import { Loading, Show, createMemo } from "solid-js";

import { LoadingState } from "../../ui/LoadingState";
import { colors } from "../../tokens.stylex.ts";

const styles = stylex.create({
  root: { backgroundColor: colors.gray2, height: "100%", overflowY: "auto" },
  fullHeight: { height: "100%" },
  content: {
    alignItems: "stretch",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 672,
    padding: 12,
    width: "100%",
  },
  heading: { color: colors.gray12, fontWeight: 500 },
  message: { color: colors.gray11, fontSize: 12, marginTop: 4 },
  warning: { color: "var(--amber-10)" },
});

export interface PluginSettingsData {
  readonly endpoints: ReadonlyArray<ClientSettings.Endpoint>;
  readonly capabilities: ReadonlySet<string>;
}

function ConnectedPluginSettings(props: {
  settings: ClientSettings.Connected<JSX.Element>;
  state: () => unknown;
  endpoints: ReadonlyArray<ClientSettings.Endpoint>;
  onChanged: () => Promise<void>;
}) {
  const view = createMemo(() =>
    props.settings.render(props.state, {
      get endpoints() {
        return props.endpoints;
      },
      get onChanged() {
        return props.onChanged;
      },
    }),
  );
  return <>{view()}</>;
}

export function PluginSettingsView(props: {
  package: Package.Model;
  settings?: ClientSettings.Connected<JSX.Element> | undefined;
  data: PluginSettingsData;
  state: () => unknown;
  requireCapability?: boolean;
  onChanged: () => Promise<void>;
}) {
  return (
    <div sx={styles.root}>
      <Loading
        fallback={<LoadingState label="Loading plugin settings" style={styles.fullHeight} />}
      >
        <div sx={styles.content}>
          <Show
            when={props.settings}
            fallback={
              <div>
                <h2 sx={styles.heading}>{props.package.name}</h2>
                <p sx={styles.message}>This plugin has no configurable editor settings.</p>
              </div>
            }
          >
            {(settings) => (
              <Show
                when={!props.requireCapability || props.data.capabilities.has(props.package.id)}
                fallback={
                  <div>
                    <h2 sx={styles.heading}>{props.package.name}</h2>
                    <p sx={[styles.message, styles.warning]}>
                      Settings are unavailable because this plugin is not hosted by the current
                      editor runtime.
                    </p>
                  </div>
                }
              >
                <ConnectedPluginSettings
                  settings={settings()}
                  state={props.state}
                  endpoints={props.data.endpoints}
                  onChanged={props.onChanged}
                />
              </Show>
            )}
          </Show>
        </div>
      </Loading>
    </div>
  );
}
