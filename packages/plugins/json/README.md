# JSON

Graph JSON values are JSON text on String pins. Use `ToJSON` to encode scalars or
scalar lists, and `FromJSON` or the typed getters to extract them. Malformed JSON
and numeric overflow fail execution. Missing properties return `None`, while JSON
null returns `Some("null")`.

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
