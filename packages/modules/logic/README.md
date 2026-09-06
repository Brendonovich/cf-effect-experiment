# Logic

Eighteen runtime-compatible nodes covering boolean operations, execution routing,
waiting, generic selection, options, and capturing values.

- Branch selects exactly one execution output. Switch selects the first matching
  strictly equal key or Default, with 0 to 1024 keys and explicitly required key inputs.
- AND, NAND, OR, NOR, XOR, and NOT implement boolean operations.
- Conditional, Equal and Switch share a node-local `T` wildcard across value pins.
  Equal and Switch retain strict equality (reference identity for object values).
- Wait uses an interruptible Effect timer for 0 to 2147483647 whole milliseconds.
- Make Some, Unwrap Option, Unwrap Option Or, Is Option Some, and Is Option None
  handle options of any inferred type without losing false, zero, or empty strings.
- Cache captures its input on execution for downstream reuse without cloning it.
- Copy captures scalars unchanged or creates a shallow copy of an input list.

Cache and Copy use a whole-value wildcard: lists, options, structs and enums require
no Type or List property. Copy shallow-copies lists and passes other values through;
Cache always preserves the captured value. Neither modifies its input.

Wildcard values need a concrete connection anchor and an input or explicit default;
no arbitrary String/number default is chosen. Option inputs retain their None default.

These nodes run on the server, in browsers, and in Cloudflare. Legacy For Each,
For Loop, and While nodes require scope execution support and are not registered.

Run tests with `pnpm --filter @macrograph/module-logic run test --run`.
