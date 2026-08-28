# OBS Studio

The catalogue contains 209 schemas: 148 request nodes (147 distinct OBS requests),
60 event nodes, and one pure RGBA colour conversion. The dedicated
`SetInputVolumeDb` node calls `SetInputVolume` with `inputVolumeDb`; the existing
multiplier node is unchanged. `ToggleOutput` calls the real `ToggleOutput` request.

## Canvas Compatibility

`GetCanvasList`, canvas events, and optional `canvasUuid` pins require a known
stable obs-websocket version of at least 5.7.0, detected from the Hello packet.
Unknown versions and prereleases are conservatively treated as unsupported.
OBS Studio's application version is not used as a proxy for websocket support.

All 33 Electron canvas-aware requests have optional canvas UUID pins, plus the
protocol-supported `GetGroupSceneItemList`, `GetSourceScreenshot`, and
`OpenSourceProjector`. An empty UUID selects the default canvas and is never sent,
so existing graphs work on earlier OBS versions. A nonempty UUID on an older
server fails explicitly with `RequestFailed` code 204 before sending a request;
unsupported request/UUID combinations fail with code 402. Canvas suggestions
use `GetCanvasList`; scene, scene-item, and source-filter suggestions use the
selected canvas where supported. Unsupported canvas suggestions propagate the
request failure rather than pretending to return a default canvas.

## High-Volume Events

High-volume subscriptions are **off by default**. Opt in using the High-Volume
Events checkboxes in plugin settings, either before adding a connection or on an
existing connection. The same configuration is available through the `AddSocket`
or `UpdateSocket` RPC's optional `highVolumeEvents` array. Supported values are
`InputVolumeMeters`, `InputActiveStateChanged`, `InputShowStateChanged`, and
`SceneItemTransformChanged`. Updates preserve an omitted setting; an empty array
disables all four. Changes take effect on the next connection (an enabled socket
is reconnected by `UpdateSocket`). Other sockets remain disconnected until you
connect them explicitly. Existing names and passwords are preserved when changing
event options.

The transport uses the exact selected subscription bits, not a wildcard mask.
It rejects unsolicited disabled high-volume events and buffers at most 64
high-volume packets, replacing the oldest packets under overload. This stream
is merged with the ordinary event stream, so high-volume traffic cannot evict
ordinary events or block request-response processing. Consumers must tolerate
lost intermediate high-volume changes; this is not a lossless telemetry feed.
Meter inputs and scene-item transforms are JSON outputs, preserving fractional
values and nested channel levels. UUIDs absent on older servers are optional.

`ConnectionOpened` comes only from the real WebSocket open callback, once per
connection, before authentication/identification. It does not mean OBS requests
are ready and can occur even when authentication subsequently fails. No synthetic
connection-success or additional connection events are emitted.

## Colour Conversion

`RGBAHexToOBSColour` is pure and needs no OBS socket. It accepts eight hex digits,
optionally prefixed with `#`, and returns OBS's unsigned ABGR integer. Unlike the
Electron helper's signed bit shifts, opaque colours remain positive 32-bit colour
values. Invalid or incomplete hex fails explicitly.

## Verification

Run `pnpm --filter @macrograph/plugin-obs test run` and `pnpm typecheck`.
Tests cover catalogue/RPC mapping, actual mocked WebSocket frames, old/new version
semantics, optional canvas payloads and suggestions, event decoding, exact
subscription masks, and slow-consumer overflow while requests continue flowing.
