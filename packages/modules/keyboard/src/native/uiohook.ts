import { EventEmitter } from "node:events";

/**
 * The packaged replacement for `uiohook-napi`'s entry. The host loads the addon from the
 * package's `native/uiohook/<target>.node`, so only the parts the module uses are rebuilt here.
 */

interface NativeEvent {
  readonly type: number;
  readonly keycode: number;
}

interface NativeBinding {
  start(listener: (event: NativeEvent) => void): void;
  stop(): void;
}

const KeyPressed = 4;
const KeyReleased = 5;

class Uiohook extends EventEmitter {
  #binding: NativeBinding | undefined;

  start() {
    const binding = (this.#binding ??= require("macrograph:native/uiohook"));
    binding.start((event: NativeEvent) => {
      if (event.type === KeyPressed) this.emit("keydown", event);
      else if (event.type === KeyReleased) this.emit("keyup", event);
    });
  }

  stop() {
    this.#binding?.stop();
  }
}

export const uIOhook = new Uiohook();
