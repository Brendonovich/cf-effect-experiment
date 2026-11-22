import { Manifest } from "@macrograph/module/Manifest";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Config, Context, Effect, Layer, Option } from "effect";

export interface SeedPublisher {
  /** Publisher name, e.g. `macrograph`. */
  readonly name: string;
  /** MacroGraph account that owns it: a user id or an email address. */
  readonly account: string;
  readonly trusted: boolean;
}

export interface Limits {
  /** Maximum size of an uploaded `.tgz`, in bytes. */
  readonly maxTarballBytes: number;
  /** Maximum total size of the unpacked files, in bytes. */
  readonly maxUnpackedBytes: number;
  readonly maxFiles: number;
}

export interface Options {
  readonly namespace: string;
  readonly displayName: string;
  /** Origin used for tarball URLs. Defaults to the request's origin. */
  readonly publicOrigin: Option.Option<string>;
  /** Accounts (user ids or emails) allowed to run admin actions. */
  readonly admins: ReadonlyArray<string>;
  /**
   * Publishers approved from configuration, created on first use. This is the initial allowlist:
   * `macrograph` and the maintainer's personal publisher.
   */
  readonly seedPublishers: ReadonlyArray<SeedPublisher>;
  /** Host interface versions accepted at publish time. */
  readonly supportedApi: ReadonlyArray<number>;
  readonly limits: Limits;
}

export const defaultLimits: Limits = {
  maxTarballBytes: 10 * 1024 * 1024,
  maxUnpackedBytes: 50 * 1024 * 1024,
  maxFiles: 1000,
};

export const defaults: Options = {
  namespace: ModuleId.OfficialNamespace,
  displayName: "MacroGraph",
  publicOrigin: Option.none(),
  admins: [],
  seedPublishers: [],
  supportedApi: [Manifest.ApiVersion],
  limits: defaultLimits,
};

export class Service extends Context.Service<Service, Options>()(
  "macrograph/cloudflare/RegistryConfig",
) {}

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

/**
 * Parses `name=account[:untrusted]` pairs, e.g.
 * `macrograph=maintainer@example.com,maintainer=maintainer@example.com`.
 */
export const parseSeedPublishers = (value: string): ReadonlyArray<SeedPublisher> =>
  list(value).flatMap((item) => {
    const match = /^([^=]+)=([^:]+)(?::(trusted|untrusted))?$/.exec(item);
    if (match === null) return [];
    const [, name = "", account = "", trust] = match;
    return [{ name: name.trim(), account: account.trim(), trusted: trust !== "untrusted" }];
  });

/** Reads `REGISTRY_ADMINS`, `REGISTRY_SEED_PUBLISHERS` and `REGISTRY_PUBLIC_ORIGIN`. */
export const layerConfig = Layer.effect(Service)(
  Effect.gen(function* () {
    const admins = yield* Config.String("REGISTRY_ADMINS").pipe(Config.withDefault(""));
    const seeds = yield* Config.String("REGISTRY_SEED_PUBLISHERS").pipe(Config.withDefault(""));
    const publicOrigin = yield* Config.option(Config.String("REGISTRY_PUBLIC_ORIGIN"));
    return {
      ...defaults,
      admins: list(admins),
      seedPublishers: parseSeedPublishers(seeds),
      publicOrigin: Option.filter(publicOrigin, (origin) => origin !== ""),
    };
  }).pipe(Effect.orDie),
);

export const layer = (options: Partial<Options>) =>
  Layer.succeed(Service, { ...defaults, ...options });
