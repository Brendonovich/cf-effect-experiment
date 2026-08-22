import { Engine, HttpEndpoint, HttpIngress } from "@macrograph/plugin";
import { Effect, Schema } from "effect";

export class DuplicateDeployment extends Schema.TaggedErrorClass<DuplicateDeployment>()(
  "DuplicateHttpIngressDeployment",
  { pluginId: Schema.String },
) {}

export interface Service {
  readonly resolveManifest: (
    engines: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<HttpIngress.Manifest, Engine.DeploymentError>;
  readonly reconcile: (
    previous: HttpIngress.Manifest,
    desired: HttpIngress.Manifest,
  ) => Effect.Effect<ReadonlyArray<HttpEndpoint.Routed>, HttpIngress.ReconciliationError>;
  readonly handle: HttpIngress.RegistryService["handle"];
  readonly mergeManifests: HttpIngress.RegistryService["mergeManifests"];
  readonly allows: HttpIngress.RegistryService["allows"];
}

const entryKey = (entry: HttpIngress.ManifestEntry) =>
  JSON.stringify([entry.pluginId, entry.handlerId, entry.instanceKey]);

const entryConfiguration = (entry: HttpIngress.ManifestEntry) =>
  JSON.stringify([entry.metadata, entry.configuration]);

export const make = (
  deployments: ReadonlyArray<Engine.AnyHttpIngressDeployment>,
  registry: HttpIngress.RegistryService,
  endpoints: HttpEndpoint.Service,
): Effect.Effect<Service, DuplicateDeployment> =>
  Effect.gen(function* () {
    const byPlugin = new Map(deployments.map((deployment) => [deployment.pluginId, deployment]));
    if (byPlugin.size !== deployments.length) {
      const duplicate = deployments.find(
        (deployment, index) =>
          deployments.findIndex((candidate) => candidate.pluginId === deployment.pluginId) !==
          index,
      );
      return yield* new DuplicateDeployment({ pluginId: duplicate?.pluginId ?? "unknown" });
    }

    return {
      resolveManifest: (engines) =>
        Effect.forEach(deployments, (deployment) =>
          deployment
            .httpIngress.resolveRequirements(
              engines[deployment.pluginId] ?? deployment.definition.InitialStorage,
            )
            .pipe(Effect.flatMap(HttpIngress.manifest)),
        ).pipe(Effect.map((manifests) => manifests.flat())),
      reconcile: (previous, desired) => {
        const desiredKeys = new Set(desired.map(entryKey));
        const previousByKey = new Map(previous.map((entry) => [entryKey(entry), entry]));
        return Effect.gen(function* () {
          const mounted = yield* Effect.forEach(desired, (entry) => {
            const previousEntry = previousByKey.get(entryKey(entry));
            const definition = registry.definitions.find(
              (candidate) =>
                candidate.id === entry.handlerId && candidate.pluginId === entry.pluginId,
            );
            if (
              previousEntry === undefined ||
              definition === undefined ||
              entryConfiguration(previousEntry) !== entryConfiguration(entry)
            )
              return registry.mount(entry, endpoints);

            return endpoints.get(definition, entry.instanceKey).pipe(
              Effect.catch(() => Effect.succeedNone),
              Effect.flatMap((existing) =>
                existing._tag === "Some"
                  ? Effect.succeed(existing.value)
                  : registry.mount(entry, endpoints),
              ),
            );
          });
          yield* Effect.forEach(
            previous.filter((entry) => !desiredKeys.has(entryKey(entry))),
            (entry) => registry.unmount(entry, endpoints),
            { discard: true },
          );
          return mounted;
        });
      },
      handle: registry.handle,
      mergeManifests: registry.mergeManifests,
      allows: registry.allows,
    };
  });

export * as HttpIngressRuntime from "./HttpIngressRuntime.ts";
