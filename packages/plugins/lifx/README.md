# LIFX LAN

Server-only port of the Electron LIFX package using `effect-node-udp` IPv4 UDP,
not an Electron bridge or the LIFX cloud API. Importing, mounting, and configuring
the plugin are inert: no socket is opened until a graph calls a light node.

## Configuration

Configure devices in plugin settings, using the bulb's MAC address and a reserved
DHCP/static IPv4 address. The server must be able to reach each bulb over UDP
(normally port 56700), and receive replies on an ephemeral local UDP port.
Containers and remote servers need LAN routing; the editor browser is not the
transport host. Configuration is project-scoped and persisted in engine storage.

```json
{
  "devices": [
    {
      "id": "d0:73:d5:12:34:56",
      "name": "Desk",
      "address": "192.168.1.50",
      "port": 56700
    }
  ],
  "timeout": 2000
}
```

IDs must be nonzero unicast MAC addresses, in colon-separated form (normalized
to lowercase). IDs must be unique; at most 128 devices are supported. Names must
contain 1-128 characters. Addresses are literal IPv4 only: no DNS, URLs,
unspecified, multicast or `.255` addresses. The conservative `.255` restriction
avoids typical directed broadcasts without needing subnet discovery. Ports are
1-65535 and per-exchange timeouts are 100-30000 ms. Only trusted editors should
configure this plugin: it can send LAN packets to configured addresses, and UDP
has no authentication. Correlation is not cryptographic peer authentication.

Manual configuration deliberately replaces broadcast discovery and observation.
There are no fake discovery/state-change events, background timers, credentials,
or network scans. Use Get Light State when a fresh state is needed.

## Nodes

Six execution schemas are registered under plugin ID `lifx`:

| Schema ID       | Function                                                                                |
| --------------- | --------------------------------------------------------------------------------------- |
| `SetLightPower` | On/off with transition duration                                                         |
| `SetLightColor` | Set hue, saturation, brightness, kelvin and duration                                    |
| `SetBrightness` | Read current color, then change only brightness                                         |
| `SetKelvin`     | Read current color, preserve hue, set saturation to zero and set temperature/brightness |
| `GetLightState` | Label, power, hue, saturation, brightness, kelvin, hex                                  |
| `HexToColor`    | Convert strict 3/6-digit hex to rounded HSB and raw LIFX values                         |

All light nodes use the `LIFXLight` resource. Hue is 0-360 degrees; saturation and
brightness are 0-100 percent, with fractional inputs/outputs supported. Write
kelvin is 1500-9000, including newer bulbs' warmer temperatures so brightness
updates can preserve them (the reference labels specified 2500-9000). Actual
bulb capabilities can be narrower. Duration is an integer 0-4294967295 milliseconds.
Color and brightness do not turn on an off bulb. Defaults are 100% brightness,
0 hue/saturation, 3500 K and zero duration. Set Kelvin defaults to 100% brightness.

State hex includes saturation **and brightness** (unlike the legacy HS-only
conversion), but does not model color temperature or power. Invalid hex fails
instead of silently leaving outputs unset. These are current graph schemas,
not persisted legacy graph migration compatibility.

## Protocol And Lifetime

Uses LightGet (101)/LightState (107), LightSetColor (102), LightSetPower (117),
and Acknowledgement (45). Setters request and await an ACK, not just successful
local UDP send. ACK means receipt, not completion of a transition or support for
every requested color value. There are no automatic retries; packet loss fails
execution, and a timed-out setter may already have applied on the bulb.

Replies must match IPv4 address, source port, device ID, source token, sequence,
message type, frame size, protocol header and expected payload length. Malformed
or unrelated frames are ignored; correlated invalid payloads fail immediately.
Each exchange has a fresh random source/sequence and a scoped ephemeral socket.
Success, failure, timeout, interruption and engine disposal close active sockets.
Binding and send are included in the exchange timeout.
The transport queues replies from socket allocation, including immediate replies
before receiving starts. Its bounded queue fails the exchange on overflow rather
than silently dropping replies. Engine disposal closes exchanges still binding
as well as bound sockets, and a disposed transport cannot open new sockets.
Disposal also awaits exchanges already finalizing after success or failure, using
the same completion barrier as the exchange's own cleanup.

Engine operations and configuration changes are serialized to protect local
read-modify-write updates. Partial updates take up to two exchange timeouts and
preserve the last read HSBK values; they cannot be atomic relative to other LAN
controllers or transitions in progress. Queue wait is not part of the exchange
timeout. No multizone/Tile, infrared, waveform, product capability query or
discovery nodes are included.

## Integration

Package exports: `.` (default plugin), `./Definition` (engine, resource, RPCs,
schemas), `./Engine` (default real Node layer; named `layer` accepts a Transport
service for tests), `./Deployment` (default standalone deployment), and
`./Settings` (default Solid v2 component and named `settings` registration).
The manifest provides `macrograph.standaloneDeployment` for standalone discovery.
Register the same plugin in editor and executor catalogs, the deployment in the
Node server, and `settings` in the editor's client settings registry. Add this
package to workspace dependency/project references as appropriate. Do not mount
its Node deployment in Cloudflare or browser runtimes.

Run `pnpm --filter @macrograph/plugin-lifx exec vitest run` and
`pnpm --filter @macrograph/plugin-lifx typecheck` after workspace installation.
Tests include independent packet fixtures, mock socket correlation/lifecycle
checks, registration/RPC tests, and a real loopback UDP bulb.
