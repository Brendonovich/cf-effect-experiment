import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { HttpClientEngine, type RequestMethod, UrlComponentFailure } from "./Definition.ts";

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
          headers: io.data.in("headers", DataType.String, {
            name: "Headers (JSON)",
            defaultValue: "{}",
          }),
          body:
            schema.method === "GET"
              ? undefined
              : io.data.in("body", DataType.String, {
                  name: "Body",
                  defaultValue: "",
                }),
          responseBody: io.data.out("responseBody", DataType.String, { name: "Response Body" }),
          contentType: io.data.out("contentType", DataType.String, { name: "Content Type" }),
          responseHeaders: io.data.out("responseHeaders", DataType.String, {
            name: "Response Headers (JSON)",
          }),
        }),
        run: ({ io, engine }) =>
          engine
            .HttpClientRequestText({
              method: schema.method,
              url: io.url,
              headers: io.headers,
              body: io.body ?? "",
            })
            .pipe(
              Effect.tap((response) =>
                Effect.sync(() => {
                  io.status(response.status);
                  io.responseBody(response.body);
                  io.contentType(response.contentType);
                  io.responseHeaders(JSON.stringify(response.headers));
                }),
              ),
              Effect.asVoid,
            ),
      });
    }

    for (const operation of ["encode", "decode"] as const) {
      yield* context.schema.register({
        id: operation === "encode" ? "URLEncodeComponent" : "URLDecodeComponent",
        name: operation === "encode" ? "URL Encode Component" : "URL Decode Component",
        description:
          operation === "encode"
            ? "Percent-encodes a URL component using encodeURIComponent."
            : "Decodes a percent-encoded URL component using decodeURIComponent.",
        type: "pure",
        io: (io) => ({
          input: io.data.in("input", DataType.String, { defaultValue: "" }),
          output: io.data.out("output", DataType.String),
        }),
        run: ({ io }) =>
          Effect.try({
            try: () =>
              io.output(
                operation === "encode"
                  ? encodeURIComponent(io.input)
                  : decodeURIComponent(io.input),
              ),
            catch: () =>
              new UrlComponentFailure({
                operation,
                reason:
                  operation === "encode"
                    ? "Invalid Unicode component"
                    : "Invalid encoded component",
              }),
          }),
      });
    }
  }),
});

export default HttpClientPlugin;
