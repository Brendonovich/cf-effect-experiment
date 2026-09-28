import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { HttpClientEngine, UrlComponentFailure } from "./Definition.ts";

const HttpClientModule = Module.make({
  id: "http-client",
  name: "HTTP Client",
  engine: HttpClientEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "HttpGet",
      name: "HTTP GET",
      description: "Makes an HTTP GET request to the specified URL.",
      io: (io) => ({
        url: io.data.in("url", t.String, { name: "URL", defaultValue: "https://" }),
        status: io.data.out("status", t.Int, { name: "Status Code" }),
        headers: io.data.in("headers", t.String, { name: "Headers (JSON)", defaultValue: "{}" }),
        responseBody: io.data.out("responseBody", t.String, { name: "Response Body" }),
        contentType: io.data.out("contentType", t.String, { name: "Content Type" }),
        responseHeaders: io.data.out("responseHeaders", t.String, {
          name: "Response Headers (JSON)",
        }),
      }),
      run: ({ io, engine }) =>
        engine
          .HttpClientRequestText({ method: "GET", url: io.url, headers: io.headers, body: "" })
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
    yield* context.schema.register({
      id: "HttpPost",
      name: "HTTP POST",
      description: "Makes an HTTP POST request to the specified URL.",
      io: (io) => ({
        url: io.data.in("url", t.String, { name: "URL", defaultValue: "https://" }),
        status: io.data.out("status", t.Int, { name: "Status Code" }),
        headers: io.data.in("headers", t.String, { name: "Headers (JSON)", defaultValue: "{}" }),
        body: io.data.in("body", t.String, { name: "Body", defaultValue: "" }),
        responseBody: io.data.out("responseBody", t.String, { name: "Response Body" }),
        contentType: io.data.out("contentType", t.String, { name: "Content Type" }),
        responseHeaders: io.data.out("responseHeaders", t.String, {
          name: "Response Headers (JSON)",
        }),
      }),
      run: ({ io, engine }) =>
        engine
          .HttpClientRequestText({
            method: "POST",
            url: io.url,
            headers: io.headers,
            body: io.body,
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
    yield* context.schema.register({
      id: "HttpPut",
      name: "HTTP PUT",
      description: "Makes an HTTP PUT request to the specified URL.",
      io: (io) => ({
        url: io.data.in("url", t.String, { name: "URL", defaultValue: "https://" }),
        status: io.data.out("status", t.Int, { name: "Status Code" }),
        headers: io.data.in("headers", t.String, { name: "Headers (JSON)", defaultValue: "{}" }),
        body: io.data.in("body", t.String, { name: "Body", defaultValue: "" }),
        responseBody: io.data.out("responseBody", t.String, { name: "Response Body" }),
        contentType: io.data.out("contentType", t.String, { name: "Content Type" }),
        responseHeaders: io.data.out("responseHeaders", t.String, {
          name: "Response Headers (JSON)",
        }),
      }),
      run: ({ io, engine }) =>
        engine
          .HttpClientRequestText({ method: "PUT", url: io.url, headers: io.headers, body: io.body })
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
    yield* context.schema.register({
      id: "HttpPatch",
      name: "HTTP PATCH",
      description: "Makes an HTTP PATCH request to the specified URL.",
      io: (io) => ({
        url: io.data.in("url", t.String, { name: "URL", defaultValue: "https://" }),
        status: io.data.out("status", t.Int, { name: "Status Code" }),
        headers: io.data.in("headers", t.String, { name: "Headers (JSON)", defaultValue: "{}" }),
        body: io.data.in("body", t.String, { name: "Body", defaultValue: "" }),
        responseBody: io.data.out("responseBody", t.String, { name: "Response Body" }),
        contentType: io.data.out("contentType", t.String, { name: "Content Type" }),
        responseHeaders: io.data.out("responseHeaders", t.String, {
          name: "Response Headers (JSON)",
        }),
      }),
      run: ({ io, engine }) =>
        engine
          .HttpClientRequestText({
            method: "PATCH",
            url: io.url,
            headers: io.headers,
            body: io.body,
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
    yield* context.schema.register({
      id: "HttpDelete",
      name: "HTTP DELETE",
      description: "Makes an HTTP DELETE request to the specified URL.",
      io: (io) => ({
        url: io.data.in("url", t.String, { name: "URL", defaultValue: "https://" }),
        status: io.data.out("status", t.Int, { name: "Status Code" }),
        headers: io.data.in("headers", t.String, { name: "Headers (JSON)", defaultValue: "{}" }),
        body: io.data.in("body", t.String, { name: "Body", defaultValue: "" }),
        responseBody: io.data.out("responseBody", t.String, { name: "Response Body" }),
        contentType: io.data.out("contentType", t.String, { name: "Content Type" }),
        responseHeaders: io.data.out("responseHeaders", t.String, {
          name: "Response Headers (JSON)",
        }),
      }),
      run: ({ io, engine }) =>
        engine
          .HttpClientRequestText({
            method: "DELETE",
            url: io.url,
            headers: io.headers,
            body: io.body,
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
    yield* context.schema.register({
      id: "URLEncodeComponent",
      name: "URL Encode Component",
      description: "Percent-encodes a URL component using encodeURIComponent.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { defaultValue: "" }),
        output: io.data.out("output", t.String),
      }),
      run: ({ io }) =>
        Effect.try({
          try: () => io.output(encodeURIComponent(io.input)),
          catch: () =>
            new UrlComponentFailure({ operation: "encode", reason: "Invalid Unicode component" }),
        }),
    });
    yield* context.schema.register({
      id: "URLDecodeComponent",
      name: "URL Decode Component",
      description: "Decodes a percent-encoded URL component using decodeURIComponent.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { defaultValue: "" }),
        output: io.data.out("output", t.String),
      }),
      run: ({ io }) =>
        Effect.try({
          try: () => io.output(decodeURIComponent(io.input)),
          catch: () =>
            new UrlComponentFailure({ operation: "decode", reason: "Invalid encoded component" }),
        }),
    });
  }),
});

export default HttpClientModule;
