import type { SchemaReferenceIOInput } from "@macrograph/editor-ui";

import { type NodeIO, Package } from "@macrograph/core";
import { type ModuleId, type t } from "@macrograph/module";
import * as Registration from "@macrograph/module/Registration";
import { createQuery } from "@tanstack/solid-query";
import { Effect, Schema } from "effect";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";
import { loadModule, loadPackage, packages } from "virtual:macrograph-reference";

import discordLogo from "../assets/integrations/discord.png";
import goxlrLogo from "../assets/integrations/goxlr.png";
import midiLogo from "../assets/integrations/midi.svg";
import obsLogo from "../assets/integrations/obs.png";
import openaiLogo from "../assets/integrations/openai.png";
import speakerBotLogo from "../assets/integrations/speaker-bot.svg";
import streamDeckLogo from "../assets/integrations/stream-deck.jpg";
import streamlabsLogo from "../assets/integrations/streamlabs.png";
import twitchLogo from "../assets/integrations/twitch.png";
import vtubeStudioLogo from "../assets/integrations/vtube-studio.png";
import websocketsLogo from "../assets/integrations/websockets.webp";

export { packages };
export type { PackageSummary } from "virtual:macrograph-reference";

type PackageName = Pick<ModuleId.Parts, "publisher" | "name">;

export const docsPath = "/docs";
/** Docs cover the official registry, so packages are addressed by publisher and name. */
export const packagePath = (pkg: PackageName) =>
  `${docsPath}/${encodeURIComponent(pkg.publisher)}/${encodeURIComponent(pkg.name)}`;
export const nodePath = (pkg: PackageName, schemaId: string) =>
  `${packagePath(pkg)}/${encodeURIComponent(schemaId)}`;

export const findPackage = (pkg: PackageName) =>
  packages.find(
    (candidate) => candidate.publisher === pkg.publisher && candidate.name === pkg.name,
  );

/** Logos for packages that have one, keyed by `publisher/name`. */
const logos: Readonly<Record<string, string>> = {
  "macrograph/discord": discordLogo,
  "macrograph/goxlr": goxlrLogo,
  "macrograph/midi": midiLogo,
  "macrograph/obs": obsLogo,
  "macrograph/openai": openaiLogo,
  "macrograph/speakerbot": speakerBotLogo,
  "macrograph/streamdeck": streamDeckLogo,
  "macrograph/streamlabs": streamlabsLogo,
  "macrograph/twitch": twitchLogo,
  "macrograph/vtube-studio": vtubeStudioLogo,
  "macrograph/websocket-client": websocketsLogo,
  "macrograph/websocket-server": websocketsLogo,
};
export const packageLogo = (pkg: PackageName): string | undefined =>
  logos[`${pkg.publisher}/${pkg.name}`];

export const packageCounts = (pkg: { readonly nodes: number; readonly resources: number }) =>
  [plural(pkg.nodes, "node"), pkg.resources > 0 ? plural(pkg.resources, "resource") : undefined]
    .filter((part) => part !== undefined)
    .join(" · ");

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const decode = Schema.decodeUnknownSync(Package.Model);

/**
 * Loads one package's reference. The query holds JSON, so the server render's cache hydrates the
 * page without loading the package again.
 */
export const usePackageReference = (id: () => ModuleId.Id) => {
  const query = createQuery(() => ({
    queryKey: ["reference", id()],
    queryFn: () => loadPackage(id()),
    staleTime: Infinity,
  }));
  // Query data is a deep store; decoding reads every field, which should not each be tracked.
  const data = createMemo((): Package.Model | undefined => {
    const encoded = query.data;
    return encoded === undefined || encoded === null ? undefined : untrack(() => decode(encoded));
  });
  return { query, data };
};

const schemaCache = new Map<
  ModuleId.Id,
  Promise<ReadonlyMap<string, Registration.RegisteredSchema>>
>();

const loadSchemas = (id: ModuleId.Id) => {
  const cached = schemaCache.get(id);
  if (cached !== undefined) return cached;
  const schemas = loadModule(id).then(async (module) =>
    module === null
      ? new Map<string, Registration.RegisteredSchema>()
      : new Map(
          (
            await Effect.runPromise(
              Registration.collectModule(module.effect, {
                moduleId: id,
                ...(module.types === undefined ? {} : { types: module.types }),
              }),
            )
          ).schemas.map((schema) => [schema.id, schema]),
        ),
  );
  schemaCache.set(id, schemas);
  return schemas;
};

/**
 * Generates node IO with the module's own code, which loads in the browser once a node page is
 * open. Until it has, and during the server render, previews show each schema's declared IO.
 */
export const useNodeIO = (id: () => ModuleId.Id, definitions: () => t.Definitions) => {
  const [schemas, setSchemas] = createSignal<ReadonlyMap<string, Registration.RegisteredSchema>>();
  createEffect(id, (moduleId) => {
    let current = true;
    void loadSchemas(moduleId).then((loaded) => {
      if (current) setSchemas(loaded);
    });
    return () => {
      current = false;
    };
  });
  return (input: SchemaReferenceIOInput): NodeIO | undefined => {
    const schema = schemas()?.get(input.schema.id);
    if (schema === undefined) return undefined;
    try {
      return Package.nodeIO(
        schema.generateIO(input.properties, { resolve: input.resolve, definitions: definitions() }),
        definitions(),
      );
    } catch {
      return undefined;
    }
  };
};
