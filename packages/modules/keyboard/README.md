# Keyboard

Respond to keybinds. The same nodes run on two transports:

- **Server** (`Deployment/Native`): a global hook through
  [`uiohook-napi`](https://github.com/SnosMe/uiohook-napi) (libuiohook), which ships prebuilt
  binaries for macOS, Linux (X11) and Windows. Keys pressed anywhere on the machine running the
  server are detected, even when MacroGraph isn't focused. The addon is loaded lazily: if it is
  missing or the hook fails to start, Settings shows the error instead of the server stopping.
- **Playground** (`Deployment/Browser`): keys pressed while the playground tab is focused.
  Presses while typing in a text field are ignored, and held keys are released when the tab loses
  focus.

## Listening

The server only listens after you enable **Listen to the keyboard** in Settings. While it is on,
graph editors can observe every key typed on the server's machine, so only enable it on a machine
you trust the project's editors with. The playground listens by default.

- **macOS:** grant the process running the server (such as your terminal or Node) Accessibility
  permission in System Settings → Privacy & Security, then turn listening off and on again.
- **Linux:** requires an X11 session. Wayland is not supported.
- **Docker:** the image doesn't include the native addon, and containers can't see the host's
  keyboard, so listening reports an error.

## Keys

Keys are identified by physical position, so `A` is the same key on QWERTY and AZERTY layouts.
Left and right modifiers share one name. Names are case-insensitive:

- Letters `A`-`Z`, digits `0`-`9`, `F1`-`F24`
- `Ctrl`, `Shift`, `Alt`, `Meta` (aliases: `Control`, `Option`, `Cmd`, `Win`, `Super`)
- `Space`, `Enter`, `Escape`, `Tab`, `Backspace`, `CapsLock`, `Insert`, `Delete`, `Home`, `End`,
  `PageUp`, `PageDown`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` (aliases: `Esc`,
  `Return`, `Up`, `Down`, `Left`, `Right`)
- `Minus`, `Equal`, `BracketLeft`, `BracketRight`, `Backslash`, `Semicolon`, `Quote`,
  `Backquote`, `Comma`, `Period`, `Slash` (or the character itself, such as `/`)
- `Numpad0`-`Numpad9`, `NumpadAdd`, `NumpadSubtract`, `NumpadMultiply`, `NumpadDivide`,
  `NumpadDecimal`, `NumpadEnter`, `NumLock`, `ScrollLock`, `PrintScreen`

A Keybind with an unrecognised key name never fires.

## Nodes

| Node          | Behavior                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Keybind`     | Properties: key, Ctrl, Shift, Alt, Meta. **Pressed** fires when the key is pressed with exactly those modifiers held; **Released** fires when it is released. |
| `KeyPressed`  | Fires for every key press. Outputs the key name and which modifiers were held.                                                                                |
| `KeyReleased` | Fires for every key release. Outputs the key name and the modifiers held when it was pressed.                                                                 |

Holding a key doesn't repeat its press. A release always reports the modifiers from its press, so
releasing Ctrl before K still fires a Ctrl+K keybind's **Released**.
