import * as Alchemy from "alchemy";
import { Effect, Option } from "effect";

/** The account dev sign-in creates, with a fixed ID so allowlists can name it. */
export const devUserId = "dev";

/** Whether this is `alchemy dev`. Only known while deploying, so use it to set a Worker's env. */
export const isDev = Effect.serviceOption(Alchemy.AlchemyContext).pipe(
  Effect.map((context) => Option.isSome(context) && context.value.dev),
);

/**
 * The comma-separated user IDs in the environment variable `name` that may use a feature before
 * it's public. `alchemy dev` adds the dev account. Read while deploying, to set a Worker's env.
 */
export const allowedUsers = (name: string) =>
  Effect.gen(function* () {
    const listed = (process.env[name] ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    return ((yield* isDev) && !listed.includes(devUserId) ? [...listed, devUserId] : listed).join(
      ",",
    );
  });
