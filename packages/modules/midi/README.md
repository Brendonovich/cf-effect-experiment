# MIDI

Send and receive MIDI with hardware connected to the server, such as a Novation Launchpad.
Uses [`@julusian/midi`](https://github.com/Julusian/node-midi) (RtMidi), which ships prebuilt
binaries for macOS, Linux (glibc and musl x64) and Windows. The packaged module ships them as
`native/midi/<target>.node` and loads the one for the server's platform through
`require("macrograph:native/midi")`. The addon is loaded lazily: if it is missing or fails to
load, the module reports MIDI as unavailable in Settings instead of stopping the server.

## Devices

Ports are rescanned every 2 seconds. Port IDs are the system port names; if several ports share
a name, the later ones get ` #2`, ` #3` and so on. Graphs refer to ports by name, so they keep
working when a device is unplugged and plugged back in.

- **Outputs** are opened when a send node first runs and stay open until the device disconnects.
- **Inputs** are only opened after you enable **Listen** in Settings, because Windows gives
  each input to only one application at a time. Enabled inputs reopen automatically when they
  reconnect. If an input fails to open, it is not retried until it reconnects, you re-enable it,
  or you press **Rescan**.

MIDI devices must be connected to the machine running the server. Containers normally cannot
see USB MIDI devices, and the Alpine-based Docker image has no ALSA library for the addon, so
MIDI usually shows as unavailable there.

On macOS, CoreMIDI may not report devices plugged in after the server started. Restart the
server if a new device doesn't appear.

## Nodes

Channels are 1-16. Note, velocity, control, value, program and pressure are 0-127. Out-of-range
inputs fail the node instead of being clamped.

| Event                  | Outputs                                                   |
| ---------------------- | --------------------------------------------------------- |
| `NoteOn`               | Channel, note, velocity                                   |
| `NoteOff`              | Channel, note, velocity. Also fires for Note On with 0.   |
| `ControlChange`        | Channel, control, value                                   |
| `ProgramChange`        | Channel, program                                          |
| `ChannelAftertouch`    | Channel, pressure                                         |
| `PolyphonicAftertouch` | Channel, note, pressure                                   |
| `PitchBend`            | Channel, bend (-8192 to 8191, 0 is center)                |
| `SysEx`                | Bytes between `F0` and `F7`                               |
| `MessageReceived`      | Raw bytes of every message (clock/active sensing ignored) |

| Send                       | Inputs                                                    |
| -------------------------- | --------------------------------------------------------- |
| `SendNoteOn`               | Channel, note, velocity                                   |
| `SendNoteOff`              | Channel, note, velocity                                   |
| `SendControlChange`        | Channel, control, value                                   |
| `SendProgramChange`        | Channel, program                                          |
| `SendChannelAftertouch`    | Channel, pressure                                         |
| `SendPolyphonicAftertouch` | Channel, note, pressure                                   |
| `SendPitchBend`            | Channel, bend (-8192 to 8191)                             |
| `SendSysEx`                | Payload bytes (0-127). `F0`/`F7` are added for you.       |
| `SendRaw`                  | Complete message; must start with a status byte (128-255) |

## Launchpad

Launchpads expose two ports, `DAW` and `MIDI`. Use the `MIDI` port. In Programmer mode, pads
are lit from Note On messages. Velocity picks a palette color.
Channel 1 is static, 2 flashes and 3 pulses. For example, `SendNoteOn` with channel 1, note 11
and velocity 5 turns the bottom-left pad red.

For full RGB, use `SendSysEx`. On a Launchpad Mini MK3, the payload
`0, 32, 41, 2, 13, 3, 3, <pad>, <r>, <g>, <b>` sets one pad to RGB values from 0-127. Use
device ID `12` instead of `13` for a Launchpad X. Check your model's programmer's reference for
other device IDs and for switching into Programmer mode.

Pad presses arrive as `NoteOn`/`NoteOff` on the Launchpad's input once **Listen** is enabled.
