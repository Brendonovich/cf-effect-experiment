import { Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import { TwitchEngine } from "./Definition.ts";

export default Plugin.make({
  id: "twitch",
  name: "Twitch",
  engine: TwitchEngine,
  effect: Effect.fnUntraced(function* (ctx) {
    yield* ctx.schema.register({
      id: "eventsub:channel.ban",
      name: "User Banned",
      type: "event",
      event: (event) => Effect.succeed(event._tag === "channel.ban"),
      io: (io) => ({
        reason: io.data.out<string>("reason"),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event?._tag === "channel.ban") io.reason(event.reason);
        }),
    });
    yield* ctx.schema.register({
      id: "helix:ban-user",
      name: "Ban User",
      io: (io) => ({
        account_id: io.data.in("accountId"),
        broadcasterId: io.data.in("broadcasterId"),
        moderatorId: io.data.in("moderatorId"),
        userId: io.data.in("userId"),
        reason: io.data.in("reason"),
        duration: io.data.in("duration"),
      }),
      run: Effect.fnUntraced(function* ({ io: _io }) {}),
    });
  }),
});
