# List

Eleven runtime-compatible nodes. Generic list nodes share an `Item` wildcard across
element and list pins, inferred from connected types (including nested containers,
DateTimes, structs and enums). There is no Type property. List inputs default to
empty; wildcard element inputs require a connection or an explicitly set default.
Editing nodes never mutate their inputs.

- List Create builds 0 to 1024 entries.
- Push, Insert, Set, and Remove List Value return new lists. Negative indices
  count from the end. Insert/Set reject out-of-range indices; Remove returns None
  and an unchanged copy when the index is out of range.
- Get List Value returns Some or None, with negative indices counting from the end.
- Get Random List Item samples with Effect Random on **execution**, not as a pure
  node. Empty lists return None without sampling; false, zero, and empty strings
  remain Some. It does not modify the list. Randomness is injectable and seedable.
- Join String List joins strings with a literal separator.
- List Includes and List Length search and count typed list values.
- Slice List copies a clamped, end-exclusive slice. Negative indices count from
  the end; end 0 means the list's end.

These nodes run on the server, in browsers, and in Cloudflare. At least one concrete
type anchor is needed before execution; an empty list alone cannot infer its item
type. Scope-based iteration is not part of this catalog.

Run tests with `pnpm --filter @macrograph/module-list run test --run`.
