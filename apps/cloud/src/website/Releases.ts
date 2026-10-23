import { Effect } from "effect";

const targets = {
  "windows-x86_64": {
    tauriTarget: "windows-x86_64",
    asset: (version: string) => `MacroGraph_${version}_x64_en-US.msi`,
  },
  "darwin-aarch64": {
    tauriTarget: "darwin-aarch64",
    asset: (version: string) => `MacroGraph_${version}_aarch64.dmg`,
  },
  "darwin-x86_64": {
    tauriTarget: "darwin-x86_64",
    asset: (version: string) => `MacroGraph_${version}_x64.dmg`,
  },
  "linux-x86_64-AppImage": {
    tauriTarget: "linux-x86_64",
    asset: (version: string) => `macro-graph_${version}_amd64.AppImage`,
  },
  "linux-x86_64-deb": {
    tauriTarget: "linux-x86_64",
    asset: (version: string) => `macro-graph_${version}_amd64.deb`,
  },
} as const;

const isTarget = (target: string): target is keyof typeof targets => Object.hasOwn(targets, target);

/** Resolves the latest desktop download URL from CrabNebula, or `undefined` for unknown targets. */
export const downloadUrl = (target: string, fetchImplementation: typeof fetch = fetch) => {
  if (!isTarget(target)) return Effect.succeed(undefined);
  const { tauriTarget, asset } = targets[target];
  return Effect.tryPromise(async () => {
    const response = await fetchImplementation(
      `https://cdn.crabnebula.app/update/macrograph/macrograph/${tauriTarget}/latest`,
    );
    if (!response.ok) throw new Error(`CrabNebula returned ${response.status}`);
    const { version } = (await response.json()) as { readonly version: unknown };
    if (typeof version !== "string") throw new Error("CrabNebula returned no version");
    return `https://cdn.crabnebula.app/download/macrograph/macrograph/latest/${asset(version)}`;
  });
};
