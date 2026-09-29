import { t } from "@macrograph/module";

export const typeChoices = [
  "String",
  "Int",
  "Float",
  "Bool",
  "DateTime",
  "List",
  "Option",
] as const;
export type TypeChoice = (typeof typeChoices)[number] | t.Struct | t.Enum;
export const choiceKey = (choice: TypeChoice) =>
  typeof choice === "string" ? choice : `${choice._tag.toLowerCase()}:${choice.id}`;
export const typeLabel = (type: t.Type, definitions: t.Definitions = {}): string =>
  type._tag === "Struct" || type._tag === "Enum"
    ? (definitions[type.id]?.name ?? `Missing type (${type.id})`)
    : type._tag === "List"
      ? `List<${typeLabel(type.item, definitions)}>`
      : type._tag === "Option"
        ? `Option<${typeLabel(type.inner, definitions)}>`
        : type._tag;
export const choiceLabel = (choice: TypeChoice, definitions: t.Definitions = {}) =>
  typeof choice === "string" ? choice : typeLabel(choice, definitions);
export const filterTypeChoices = (
  search: string,
  definitions: t.Definitions = {},
): TypeChoice[] => {
  const query = search.trim().toLowerCase();
  return [...typeChoices, ...Object.values(definitions).map(t.fromDefinition)].filter((choice) =>
    `${choiceLabel(choice, definitions)} ${choiceKey(choice)}`.toLowerCase().includes(query),
  );
};
export const typeSegments = (type: t.Type): ReadonlyArray<t.Type> => [
  type,
  ...(type._tag === "List"
    ? typeSegments(type.item)
    : type._tag === "Option"
      ? typeSegments(type.inner)
      : []),
];
export const replaceTypeSegment = (type: t.Type, depth: number, choice: TypeChoice): t.Type => {
  if (depth > 0) {
    if (type._tag === "List") return t.List(replaceTypeSegment(type.item, depth - 1, choice));
    if (type._tag === "Option") return t.Option(replaceTypeSegment(type.inner, depth - 1, choice));
    return type;
  }
  const inner = type._tag === "List" ? type.item : type._tag === "Option" ? type.inner : type;
  return typeof choice !== "string"
    ? choice
    : choice === "List"
      ? t.List(inner)
      : choice === "Option"
        ? t.Option(inner)
        : t[choice];
};
