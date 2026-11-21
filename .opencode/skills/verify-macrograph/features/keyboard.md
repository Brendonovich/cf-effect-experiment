# Keyboard keybinds

- **Feature ID:** `module.keyboard.keybind`
- **Status:** Covered
- **Mode:** `keyboard`
- **Command:** `pnpm verify:playground:keyboard`

## User-visible contract

The playground mounts the Keyboard module with the browser transport, listening by default. A Keybind node fires its **Pressed** output when its key is pressed in the focused tab with exactly the chosen modifiers held, and its **Released** output when that key is released. Held keys don't repeat. Presses while focus is in a text field are ignored. The self-hosted server uses a global OS hook instead, which this harness does not exercise.

## Assertions and evidence

The harness imports `keyboard-project.json` (a Shift+K Keybind whose outputs drive two Print nodes). It presses K, Ctrl+Shift+K, then holds Shift+K and asserts exactly one "keybind pressed" entry and no release entry. After releasing, it waits for "keybind released", presses Shift+K inside a temporary text input, and asserts each entry still appears exactly once. Evidence includes `keyboard-keybind.png`, the imported project, and the server log.
