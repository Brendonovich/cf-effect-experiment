# JSON

Graph JSON values are JSON text on String pins. `ToJSON`, `FromJSON` and
`JSONGetScalarList` infer conversion types from wildcard connections instead of
Type/List properties. They use the resolved type's JSON codec, including nested
List/Option, DateTime, and nominal custom values. `FromJSON` returns None on type
mismatches; `ToJSON` requires a value matching its inferred type. Malformed JSON
and numeric overflow fail execution. Missing properties return `None`, while JSON
null returns `Some("null")`.

Typed scalar getters remain concrete. Generic conversions need a concrete anchor
on their value side; a JSON String input does not determine the decoded type.

The Electron Map catalog's JSON-compatible operations are available here without
introducing a pretend native Map pin type:

- `JSONCreateObject`: dynamic key/JSON-value pairs (0 to 1024 entries), last duplicate wins.
- `JSONSetProperty`: inserts or replaces an own key, returning a new object and the previous optional JSON value.
- `JSONRemoveProperty`: returns a new object and the removed optional JSON value.
- `JSONHasProperty`: checks own-key presence, including null-valued keys.
- `JSONGetObjectSize`: counts own keys.
- `JSONGetObjectValues`: returns a list of JSON texts in JavaScript object-key order.
- Existing `JSONGetProperty`, `JSONGetObjectKeys`, and `QueryJSON` provide lookup and keys.

The new object operations require an object, not an array or scalar. Keys such as
`__proto__` and `constructor` are ordinary data, never inherited properties.
Edits are immutable and pure: they do not mutate other nodes' input values.
These are explicit JSON adaptations, not legacy graph migration or wildcard Map
support. JavaScript object-key order differs from Map insertion order for integer
keys. Clear an object by replacing it with `{}`.
