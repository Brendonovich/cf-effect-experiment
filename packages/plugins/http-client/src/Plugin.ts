import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { HttpClientEngine, type RequestMethod } from "./Definition.ts";

const schemas: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly method: RequestMethod;
}> = [
  { id: "HttpGet", name: "HTTP GET", method: "GET" },
  { id: "HttpPost", name: "HTTP POST", method: "POST" },
  { id: "HttpPut", name: "HTTP PUT", method: "PUT" },
  { id: "HttpPatch", name: "HTTP PATCH", method: "PATCH" },
  { id: "HttpDelete", name: "HTTP DELETE", method: "DELETE" },
];

const HttpClientPlugin = Plugin.make({
  id: "http-client",
  name: "HTTP Client",
  engine: HttpClientEngine,
  effect: Effect.fnUntraced(function* (context) {
    for (const schema of schemas) {
      yield* context.schema.register({
        id: schema.id,
        name: schema.name,
        description: `Makes an HTTP ${schema.method} request to the specified URL.`,
        io: (io) => ({
          url: io.data.in("url", DataType.String, { name: "URL", defaultValue: "https://" }),
          status: io.data.out("status", DataType.Int, { name: "Status Code" }),
        }),
        run: ({ io, engine }) =>
          engine.HttpClientRequest({ method: schema.method, url: io.url }).pipe(
            Effect.tap((status) => Effect.sync(() => io.status(status))),
            Effect.asVoid,
          ),
      });
    }
  }),
});

export default HttpClientPlugin;
