import { DataType } from "@macrograph/plugin/DataType";

export const typeChoices = [
  "String",
  "Int",
  "Float",
  "Bool",
  "DateTime",
  "List",
  "Option",
] as const;
export type TypeChoice = (typeof typeChoices)[number] | DataType.Custom;
export const choiceKey = (choice: TypeChoice) =>
  typeof choice === "string" ? choice : `custom:${choice.id}`;
export const typeLabel = (type: DataType.Any, definitions: DataType.Definitions = {}): string =>
  type._tag === "Custom"
    ? (definitions[type.id]?.name ?? `Missing type (${type.id})`)
    : type._tag === "List"
      ? `List<${typeLabel(type.item, definitions)}>`
      : type._tag === "Option"
        ? `Option<${typeLabel(type.inner, definitions)}>`
        : type._tag;
export const choiceLabel = (choice: TypeChoice, definitions: DataType.Definitions = {}) =>
  typeof choice === "string" ? choice : typeLabel(choice, definitions);
export const filterTypeChoices = (
  search: string,
  definitions: DataType.Definitions = {},
): TypeChoice[] => {
  const query = search.trim().toLowerCase();
  return [
    ...typeChoices,
    ...Object.values(definitions).map((definition) => DataType.Custom(definition.id)),
  ].filter((choice) =>
    `${choiceLabel(choice, definitions)} ${choiceKey(choice)}`.toLowerCase().includes(query),
  );
};
export const typeSegments = (type: DataType.Any): ReadonlyArray<DataType.Any> => [
  type,
  ...(type._tag === "List"
    ? typeSegments(type.item)
    : type._tag === "Option"
      ? typeSegments(type.inner)
      : []),
];
export const replaceTypeSegment = (
  type: DataType.Any,
  depth: number,
  choice: TypeChoice,
): DataType.Any => {
  if (depth > 0) {
    if (type._tag === "List")
      return DataType.List(replaceTypeSegment(type.item, depth - 1, choice));
    if (type._tag === "Option")
      return DataType.Option(replaceTypeSegment(type.inner, depth - 1, choice));
    return type;
  }
  const inner = type._tag === "List" ? type.item : type._tag === "Option" ? type.inner : type;
  return typeof choice !== "string"
    ? choice
    : choice === "List"
      ? DataType.List(inner)
      : choice === "Option"
        ? DataType.Option(inner)
        : DataType[choice];
};

export const parseListType = (value: unknown): DataType.Any | undefined => {
  return typeof value === "string" ? DataType.parseSelector(value) : undefined;
};
