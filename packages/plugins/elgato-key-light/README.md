# Elgato Key Light

Native server-side HTTP control of manually configured Elgato Key Lights. No Electron bridge,
browser transport, credentials, secrets, or external SDK is required. The deployment uses the
Effect's `HttpClient` with `FetchHttpClient.layer`, including abort signals for timeouts and
execution cancellation.

## Configuration

Add a device in Settings with a name, HTTP origin (for example `http://192.168.1.20:9123`) and
request timeout (100-30000 milliseconds, UI default 5000). An omitted port defaults to 9123;
explicit ports 1-65535, hostnames, IPv4 and bracketed IPv6 addresses are supported. HTTPS,
credentials, paths, queries, fragments and redirects are rejected. Settings supports add,
edit, remove and an explicit read-only Test action. Device IDs remain stable when edited.

Mounting and saving configuration never contact devices, even with configured devices. There
are no timers, subnet scans, mDNS queries, or automatic polling. **Discovery and the Device
Discovered event are deferred**: use your router or Elgato Control Center to find the device's
address, preferably with a DHCP reservation. This replaces the old subnet-scanning discovery
node rather than pretending configured devices were discovered.

This is intended for a trusted local/server deployment that can reach the lights' LAN.
Configured private addresses are deliberately allowed. Do not expose device configuration to
untrusted users or mount this deployment in an unrestricted public multi-tenant server.

## Nodes

| ID                     | Behavior                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `GetState`             | Read power, brightness and Kelvin temperature of the first light channel.                        |
| `SetState`             | Set power, brightness (0-100) and Kelvin temperature (2900-7000). All three inputs are explicit. |
| `Toggle`               | Invert the first channel's power and apply it to all channels; return actual resulting power.    |
| `IncrementBrightness`  | Add a signed integer delta, clamp to 0-100, return resulting brightness.                         |
| `IncrementTemperature` | Add a signed Kelvin delta, clamp to 2900-7000, return resulting Kelvin temperature.              |
| `SetBrightness`        | Set only brightness, preserving power and temperature.                                           |
| `SetTemperature`       | Set only Kelvin temperature, preserving power and brightness.                                    |
| `BrightnessToPercent`  | Pure conversion to float; brightness is already a 0-100 percent value.                           |
| `KelvinToMireds`       | Pure conversion of valid Key Light Kelvin temperatures to integer mireds.                        |
| `MiredsToKelvin`       | Pure conversion of valid device mireds (143-344) to integer Kelvin.                              |

The seven control nodes select the `ElgatoKeyLightDevice` resource. The three conversion nodes
require no device. Temperature conversion rounds to the nearest integer and saturates at the
device's supported 143-344 mired bounds. Quantization means requested 2900 K reads back as
2907 K, and 7000 K reads back as 6993 K. Invalid/nonfinite/fractional/out-of-range inputs fail
instead of silently clamping; only increments and the temperature quantization saturate.

Every write performs one GET followed by one PUT to `/elgato/lights`, preserving each channel's
unchanged power, brightness and temperature. As in the source plugin, requested changes apply
to all channels using the first channel as the increment/toggle baseline. Operations and
settings mutations are serialized within this engine to prevent local read-modify-write lost
updates; another control app or engine can still race with it. The timeout applies separately
to each HTTP request, including reading its body, so a write can take up to twice the timeout.

Transport errors, timeouts, non-2xx statuses, redirects, invalid JSON/UTF-8, empty bodies,
responses over 64 KiB, invalid light values and inconsistent light counts fail with the typed
`ElgatoKeyLightFailure` error. Responses must contain 1-16 light channels. Nodes never return
invented state on failure; write outputs reflect the validated PUT response.

## Integration

Package: `@macrograph/plugin-elgato-key-light`. Default root export is the plugin catalog.
`/Definition` exports `KeyLightEngine`, `KeyLightDevice`, branded `DeviceId`, device/state/
operation schemas, storage/client state, RPC groups and `KeyLightFailure`. `/Engine` exports
the self-contained native HTTP `layer` (default) and `runtimeLayer`, which requires Effect's
`HttpClient` service. `/Deployment` default exports `Engine.deployment(plugin, layer)` and is declared
in `macrograph.standaloneDeployment`. `/Settings` exports the `settings` descriptor.

The application must install the workspace dependency, register the plugin and settings,
mount the deployment and include the package in its TypeScript project references. No shared
or application wiring is included in this package. No additional transport layer is needed.

Run `pnpm --filter @macrograph/plugin-elgato-key-light exec vitest run` and
`pnpm --filter @macrograph/plugin-elgato-key-light typecheck` after workspace installation.
Tests cover the catalog, RPC routing, mocked HTTP payloads/responses, configuration validation,
timeouts, cancellation and failure propagation. Physical device testing is not automated.
