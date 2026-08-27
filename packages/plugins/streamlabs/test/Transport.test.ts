import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { io } from "socket.io-client";
import { vi } from "vitest";

import { SocketFactory, socketLayer } from "../src/Transport.ts";

vi.mock("socket.io-client", () => ({ io: vi.fn() }));

describe("Streamlabs SDK transport", () => {
  it.effect("uses the fixed server origin and SDK lifecycle options", () =>
    Effect.gen(function* () {
      const factory = yield* SocketFactory.pipe(Effect.provide(socketLayer));
      factory.create("private-socket-token");
      assert.deepStrictEqual(vi.mocked(io).mock.lastCall, [
        "https://sockets.streamlabs.com",
        {
          query: { token: "private-socket-token" },
          transports: ["websocket"],
          autoConnect: false,
          forceNew: true,
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 30000,
        },
      ]);
    }),
  );
});
