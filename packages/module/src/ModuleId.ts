import { Option, Schema } from "effect";

export const OfficialNamespace = "macrograph.app";
export const LocalNamespace = "local";

export const ReservedNamespaces: ReadonlyArray<string> = [LocalNamespace];
/** Publishers reserved on the official registry. */
export const ReservedPublishers: ReadonlyArray<string> = ["macrograph"];

const segment = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const domain = `${label}(?:\\.${label})+`;

const segmentPattern = new RegExp(`^${segment}$`);
const domainPattern = new RegExp(`^${domain}$`);
const idPattern = new RegExp(`^(?:${LocalNamespace}|${domain})/${segment}/${segment}$`);

export const isSegment = (value: string) => value.length <= 64 && segmentPattern.test(value);
export const isDomain = (value: string) => value.length <= 253 && domainPattern.test(value);
export const isNamespace = (value: string) => value === LocalNamespace || isDomain(value);
/** Whether a registry may declare this namespace in its metadata. */
export const isRegistryNamespace = (value: string) =>
  isDomain(value) && !ReservedNamespaces.includes(value);
export const isReservedPublisher = (publisher: string) => ReservedPublishers.includes(publisher);

const segmentMessage = "Expected lowercase letters, digits and hyphens";

export const Publisher = Schema.String.check(
  Schema.makeFilter((value: string) => isSegment(value) || segmentMessage),
);
export type Publisher = typeof Publisher.Type;

export const Name = Schema.String.check(
  Schema.makeFilter((value: string) => isSegment(value) || segmentMessage),
);
export type Name = typeof Name.Type;

export const Namespace = Schema.String.check(
  Schema.makeFilter(
    (value: string) => isNamespace(value) || `Expected "${LocalNamespace}" or a domain name`,
  ),
);
export type Namespace = typeof Namespace.Type;

export const Id = Schema.String.check(
  Schema.makeFilter(
    (value: string) =>
      (value.length <= 383 && idPattern.test(value)) ||
      "Expected a module id of the form namespace/publisher/name",
  ),
).pipe(Schema.brand("ModuleId"));
export type Id = typeof Id.Type;

export const Parts = Schema.Struct({ namespace: Namespace, publisher: Publisher, name: Name });
export type Parts = typeof Parts.Type;

export const format = (parts: Parts): string =>
  `${parts.namespace}/${parts.publisher}/${parts.name}`;

/** Builds an id from its parts, throwing if any part is invalid. */
export const make = (parts: Parts): Id => Id.make(format(parts));

export const is = Schema.is(Id);
export const parse = (value: string): Option.Option<Id> => Schema.decodeUnknownOption(Id)(value);
export const decode = Schema.decodeUnknownEffect(Id);

export const parts = (id: Id): Parts => {
  const [namespace = "", publisher = "", name = ""] = id.split("/");
  return { namespace, publisher, name };
};
export const namespace = (id: Id): Namespace => parts(id).namespace;
export const publisher = (id: Id): Publisher => parts(id).publisher;
export const name = (id: Id): Name => parts(id).name;

export const isLocal = (id: Id) => namespace(id) === LocalNamespace;
export const isOfficial = (id: Id) => namespace(id) === OfficialNamespace;

export const withNamespace = (id: Id, namespace: Namespace): Id =>
  make({ ...parts(id), namespace });

/** Official-registry ids drop their namespace, e.g. `macrograph/twitch`. */
export const toDisplay = (id: Id): string => {
  const value = parts(id);
  return value.namespace === OfficialNamespace ? `${value.publisher}/${value.name}` : id;
};

/** Accepts the full form or the official short form. */
export const parseDisplay = (value: string): Option.Option<Id> =>
  value.split("/").length === 2 ? parse(`${OfficialNamespace}/${value}`) : parse(value);

/** Route prefix that serves a module's RPCs, UI and assets. */
export const routePrefix = (id: Id) => `/module/${id}`;

export * as ModuleId from "./ModuleId.ts";
