export interface SearchDocument<T> {
  readonly item: T;
  readonly key: string;
  readonly fields: ReadonlyArray<string | undefined>;
  readonly terms?: ReadonlyArray<string>;
}

const words = (value: string) =>
  value.match(/\p{Lu}?\p{Ll}+|\p{Lu}+(?!\p{Ll})|[\p{Lo}\p{Lm}]+|\p{N}+/gu)?.map((part) => part.toLowerCase()) ?? [];

export const tokenizeSearch = (value: string): ReadonlyArray<string> =>
  value
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap(words)
    .filter((token) => token.length > 0);

const isSubsequence = (query: string, candidate: string) => {
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
};

export const searchScore = (
  query: string | ReadonlyArray<string>,
  fields: ReadonlyArray<string | undefined>,
  terms: ReadonlyArray<string> = [],
): number | undefined => {
  const queryTokens = typeof query === "string" ? tokenizeSearch(query) : query;
  if (queryTokens.length === 0) return 0;
  const fieldTokens = [...fields, ...terms].flatMap((field) => tokenizeSearch(field ?? ""));
  const normalizedFields = fields.map((field) => field?.toLowerCase() ?? "");
  const acronym = fieldTokens.map((token) => token[0]).join("");
  let total = 0;

  for (const token of queryTokens) {
    let best = 0;
    if (fieldTokens.includes(token)) best = 120;
    else if (fieldTokens.some((candidate) => candidate.startsWith(token))) best = 90;
    else if (acronym.startsWith(token)) best = 80;
    else if (normalizedFields.some((field) => field.includes(token))) best = 65;
    else if (fieldTokens.some((candidate) => isSubsequence(token, candidate))) best = 35;
    if (best === 0) return undefined;
    total += best;
  }
  return total;
};

export const rankedSearch = <T>(
  query: string,
  documents: ReadonlyArray<SearchDocument<T>>,
): ReadonlyArray<T> => {
  const tokens = tokenizeSearch(query);
  return documents
    .flatMap((document, index) => {
      const score = searchScore(tokens, document.fields, document.terms);
      return score === undefined ? [] : [{ ...document, index, score }];
    })
    .sort((left, right) =>
      right.score - left.score || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0) || left.index - right.index,
    )
    .map(({ item }) => item);
};
