import { Effect } from "effect";

const value = await Promise.resolve(1);

export default { effect: () => Effect.succeed(value) };
