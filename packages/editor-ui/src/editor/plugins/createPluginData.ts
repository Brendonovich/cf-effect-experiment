import type { EditorEvent } from "@macrograph/editor";

import { Actor, type Package, type ResourceConstant } from "@macrograph/core";
import { Cause, Effect } from "effect";
import { createMemo, refresh } from "solid-js";

import type { PluginSettingsData } from "./PluginSettingsView";
import type { EditorConnection, PluginSettingsDescriptor } from "../Editor";

import { runPromise } from "../../observability/browserTracing";

type Connection = {
  readonly client: {
    readonly GetIngressEndpoints: (
      payload: Record<string, never>,
    ) => Effect.Effect<PluginSettingsData["endpoints"], unknown>;
    readonly GetPluginSettingsCapabilities: () => Effect.Effect<
      ReadonlyArray<{ readonly pluginId: string }>,
      unknown
    >;
    readonly GetPluginClientState: (payload: {
      readonly pluginId: string;
    }) => Effect.Effect<unknown, unknown>;
    readonly ReloadResource: (payload: {
      readonly package: string;
      readonly resource: string;
    }) => Effect.Effect<unknown, unknown>;
    readonly GetResourceValues: (payload: {
      readonly package: string;
      readonly resource: string;
    }) => Effect.Effect<ReadonlyArray<ResourceConstant.LiveValue>, unknown>;
  };
  readonly pluginSettings: EditorConnection["pluginSettings"];
};

export function createPluginData(
  descriptors: ReadonlyArray<Pick<PluginSettingsDescriptor, "id" | "initial">>,
  applyEvent: (event: EditorEvent.EditorEvent) => void,
) {
  let session:
    | {
        readonly connection: Connection;
        readonly packages: ReadonlyArray<Pick<Package.Model, "id" | "resources">>;
        readonly resourceRequests: Map<string, object>;
      }
    | undefined;
  const query = <A>(initial: A, label: string) => {
    let value = initial;
    let pending: Promise<A> = Promise.resolve(initial);
    // Start requests independently of Solid; the memo only exposes their results.
    const state = createMemo(() => pending);
    return {
      state,
      load(effect: Effect.Effect<A, unknown>) {
        const request = runPromise(
          effect.pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                if (!Cause.hasInterruptsOnly(cause)) yield* Effect.logError(label, cause);
                return value;
              }),
            ),
          ),
        ).then((result) => {
          if (pending === request) value = result;
          return result;
        });
        pending = request;
        refresh(state);
        return request;
      },
      clear(retain: boolean) {
        if (!retain) value = initial;
        pending = Promise.resolve(value);
        refresh(state);
      },
    };
  };
  const emptyMetadata: PluginSettingsData = { endpoints: [], capabilities: new Set() };
  const metadata = query(emptyMetadata, "Failed to load plugin settings");
  const states = new Map(
    descriptors.map(
      (descriptor) =>
        [
          descriptor.id,
          query(descriptor.initial, `Failed to load ${descriptor.id} plugin state`),
        ] as const,
    ),
  );

  const reload = (pluginId?: string) => {
    const current = session;
    if (current === undefined) return Promise.resolve();
    const client = current.connection.client;
    const pending: Array<Promise<unknown>> = [
      metadata.load(
        Effect.all([client.GetIngressEndpoints({}), client.GetPluginSettingsCapabilities()], {
          concurrency: "unbounded",
        }).pipe(
          Effect.map(([endpoints, capabilities]) => ({
            endpoints,
            capabilities: new Set(capabilities.map((capability) => capability.pluginId)),
          })),
        ),
      ),
    ];
    for (const [id, state] of states) {
      if (pluginId !== undefined && id !== pluginId) continue;
      const settings = current.connection.pluginSettings.get(id);
      if (settings === undefined || !current.packages.some((pkg) => pkg.id === id)) {
        state.clear(false);
        continue;
      }
      pending.push(
        state.load(settings.load((pluginId) => client.GetPluginClientState({ pluginId }))),
      );
    }
    pending.push(
      runPromise(
        Effect.forEach(
          current.packages.filter((pkg) => pluginId === undefined || pkg.id === pluginId),
          (pkg) => {
            const request = {};
            current.resourceRequests.set(pkg.id, request);
            return Effect.forEach(
              pkg.resources,
              (resource) =>
                current.connection.client
                  .ReloadResource({ package: pkg.id, resource: resource.id })
                  .pipe(
                    Effect.andThen(
                      current.connection.client.GetResourceValues({
                        package: pkg.id,
                        resource: resource.id,
                      }),
                    ),
                    Effect.tap((values) =>
                      Effect.sync(() => {
                        if (session !== current || current.resourceRequests.get(pkg.id) !== request)
                          return;
                        applyEvent({
                          _tag: "ResourceValuesUpdated",
                          actor: Actor.system,
                          package: pkg.id,
                          resource: resource.id,
                          values,
                        });
                      }),
                    ),
                    Effect.catchCause((cause) =>
                      Effect.logError(
                        `Failed to load ${pkg.id}/${resource.id} resource values`,
                        cause,
                      ),
                    ),
                  ),
              { concurrency: "unbounded", discard: true },
            );
          },
          { concurrency: "unbounded", discard: true },
        ),
      ),
    );
    return Promise.all(pending).then(() => undefined);
  };

  return {
    metadata: metadata.state,
    states: new Map(Array.from(states, ([id, query]) => [id, query.state])),
    refresh: reload,
    connect(
      connection: Connection,
      packages: ReadonlyArray<Pick<Package.Model, "id" | "resources">>,
    ) {
      session = { connection, packages, resourceRequests: new Map() };
      return reload();
    },
    disconnect(keepData = false) {
      session = undefined;
      metadata.clear(keepData);
      for (const state of states.values()) state.clear(keepData);
    },
  };
}
