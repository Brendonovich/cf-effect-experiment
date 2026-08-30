# Protocol delivery contract

`@macrograph/streamdeck-protocol` is the single wire contract between MacroGraph
and the external Stream Deck `.sdPlugin` (separate repo).

## What this package exports

| Entry | Contents | Dependencies |
| ----- | -------- | ------------ |
| `@macrograph/streamdeck-protocol` | Constants, plain TS types, message builders | **None** (no Effect) |
| `@macrograph/streamdeck-protocol/schema` | Effect `Schema` codecs for MG-side decode/encode | `effect` (catalog) |

The external plugin **must** import only the root entry (or copy its builders).
It must not depend on `./schema` unless it already bundles Effect.

## Delivery options (pick one)

1. **file: link** (local monorepo sibling) — used by the SDPlugin workspace today:
   `"@macrograph/streamdeck-protocol": "file:../cf-effect-experiment/packages/streamdeck-protocol"`
2. **Git dependency** — pin a MacroGraph commit/tag that contains this package.
3. **npm publish** — publish `@macrograph/streamdeck-protocol` when ready; bump
   `PROTOCOL_VERSION` only on breaking wire changes.
4. **Vendored snapshot** — copy `src/index.ts` into the plugin repo; add a CI
   check that diffs against this package.

## Handshake (locked)

- `PROTOCOL_VERSION = 1`
- `CLIENT_ID = "macrograph-streamdeck"`
- Plugin → MG: `{ type: "hello", version, client, pluginUuid }`
- MG → plugin: `{ type: "helloAck", version }`
- Binding key in action settings: `BUTTON_SETTING_KEY = "mgButtonId"`

Mismatch (wrong `version` / `client`): MacroGraph logs a warning, does **not**
ack, and ignores further messages from that socket client.

## Manifest template

See `manifest.template.json` for the Elgato plugin UUID / action skeleton the
external repo should start from (`SupportedInMultiActions: false` in v1).
