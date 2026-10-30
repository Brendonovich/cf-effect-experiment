import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { Effect } from "effect";

import type { Instances } from "../Instance.ts";

import { type Client, fromClient } from "../Client.ts";
import { type ConnectionTarget, RequestFailure } from "../Definition.ts";
import { makeLayer } from "../Engine.ts";

export type Discover = () => Promise<Client | undefined>;

const discover: Discover = async () => {
  const endpoint = await Service.discover();
  if (endpoint === undefined) return undefined;
  const service =
    endpoint.auth === undefined
      ? { url: endpoint.url }
      : { url: endpoint.url, auth: endpoint.auth };
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(service) });
};

const failure = (reason: string) => new RequestFailure({ reason });

const remoteClient = (target: Extract<ConnectionTarget, { readonly type: "remote" }>) =>
  Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => {
        const parsed = new URL(target.url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
        parsed.username = "";
        parsed.password = "";
        return parsed.href.replace(/\/$/, "");
      },
      catch: () => failure("OpenCode server URL must use HTTP or HTTPS"),
    });
    const endpoint =
      target.password === ""
        ? { url }
        : {
            url,
            auth: { type: "basic" as const, username: "opencode", password: target.password },
          };
    const client = OpenCode.make({ baseUrl: url, headers: Service.headers(endpoint) });
    yield* Effect.tryPromise({
      try: () => client.server.info(),
      catch: () => failure("Could not connect to the OpenCode server"),
    });
    return client;
  });

export const makeInstances = (find: Discover = discover): Instances => ({
  connectionTypes: ["local", "remote"],
  resolve: ({ target }) => {
    if (target.type === "managed")
      return Effect.fail(failure("Managed OpenCode connections are unavailable on this server"));
    const client =
      target.type === "remote"
        ? remoteClient(target)
        : Effect.tryPromise({
            try: find,
            catch: () => failure("Could not discover the local OpenCode service"),
          }).pipe(
            Effect.flatMap((found) =>
              found === undefined
                ? Effect.fail(failure("No running local OpenCode service was discovered"))
                : Effect.succeed(found),
            ),
          );
    return client.pipe(Effect.map(fromClient));
  },
});

export const instances = makeInstances();
export const layer = makeLayer(instances);
export default layer;
