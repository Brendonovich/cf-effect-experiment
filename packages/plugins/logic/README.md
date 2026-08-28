# Logic

Eighteen runtime-compatible nodes covering boolean operations, execution routing,
waiting, scalar selection, options, and capturing values.

- Branch selects exactly one execution output. Switch selects the first matching
  scalar key or Default, with 0 to 1024 keys and explicitly required key inputs.
- AND, NAND, OR, NOR, XOR, and NOT implement boolean operations.
- Conditional and Equal use the configured scalar Type: String, Int, Float, or Bool.
- Wait uses an interruptible Effect timer for 0 to 2147483647 whole milliseconds.
- Make Some, Unwrap Option, Unwrap Option Or, Is Option Some, and Is Option None
  handle scalar options without losing false, zero, or empty strings.
- Cache captures its input on execution for downstream reuse without cloning it.
- Copy captures scalars unchanged or creates a shallow copy of an input list.

Cache and Copy retain their existing scalar pins by default. Enable their List
property to use lists of the configured scalar Type; list inputs default to empty.
Neither node modifies the input. Maps, structs, and enums remain unsupported.

These nodes run on the server, in browsers, and in Cloudflare. Legacy For Each,
For Loop, and While nodes require scope execution support and are not registered.

Run tests with `pnpm --filter @macrograph/plugin-logic run test --run`.
