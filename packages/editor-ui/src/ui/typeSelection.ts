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
export type TypeChoice = (typeof typeChoices)[number];
export const filterTypeChoices = (search: string) =>
  typeChoices.filter((type) => type.toLowerCase().includes(search.trim().toLowerCase()));
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
  // Like the legacy editor, changing a container retains its child; wrapping a leaf retains the leaf.
  const inner = type._tag === "List" ? type.item : type._tag === "Option" ? type.inner : type;
  return choice === "List"
    ? DataType.List(inner)
    : choice === "Option"
      ? DataType.Option(inner)
      : DataType[choice];
};
