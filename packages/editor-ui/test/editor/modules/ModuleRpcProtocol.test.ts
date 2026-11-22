import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { Rpc, RpcClient, RpcGroup } from "effect/rpc";
import { describe, expect, it } from "vitest";

import { ModuleRpcProtocol } from "../../../src/editor/modules/ModuleRpcProtocol";

const Rpcs = RpcGroup.make(
  Rpc.make("Echo", { payload: { value: Schema.String }, success: Schema.String }),
);

const id = ModuleId.make({ namespace: "macrograph.app", publisher: "macrograph", name: "twitch" });

describe("module RPC protocols", () => {
  it("routes each namespaced module id under the base path", () => {
    expect(ModuleRpcProtocol.httpUrl("https://host.test", id)).toBe(
      "https://host.test/module/macrograph.app/macrograph/twitch/rpc",
    );
    expect(ModuleRpcProtocol.httpUrl("https://host.test/app", id)).toBe(
      "https://host.test/app/module/macrograph.app/macrograph/twitch/rpc",
    );
    expect(
      ModuleRpcProtocol.httpUrl(
        "https://host.test/app/",
        ModuleId.make({ namespace: "local", publisher: "me", name: "thing" }),
      ),
    ).toBe("https://host.test/app/module/local/me/thing/rpc");
  });

  it("sends NDJSON over HTTP with the session token read on every request", async () => {
    const requests: Array<{ url: string; authorization?: string; contentType?: string }> = [];
    const client = HttpClient.make((request, url) =>
      Effect.sync(() => {
        const body = request.body;
        const text = body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "";
        const message = JSON.parse(text.trim()) as {
          readonly id: string;
          readonly payload: { readonly value: string };
        };
        requests.push({
          url: url.href,
          ...(request.headers.authorization === undefined
            ? {}
            : { authorization: request.headers.authorization }),
          ...(request.headers["content-type"] === undefined
            ? {}
            : { contentType: request.headers["content-type"] }),
        });
        const exit = {
          _tag: "Exit",
          requestId: message.id,
          exit: { _tag: "Success", value: message.payload.value },
        };
        return HttpClientResponse.fromWeb(
          request,
          new Response(`${JSON.stringify(exit)}\n`, {
            headers: { "content-type": "application/x-ndjson" },
          }),
        );
      }),
    );
    let token: string | null = "first";
    const results = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const factory = yield* ModuleRpcProtocol.http({
            baseUrl: "https://host.test/base/",
            token: () => token,
          }).pipe(Effect.provideService(HttpClient.HttpClient, client));
          const rpc = yield* factory(id);
          if (rpc._tag !== "Protocol") throw new Error("Expected an HTTP protocol");
          const echo = yield* RpcClient.make(Rpcs).pipe(
            Effect.provideService(RpcClient.Protocol, rpc.protocol),
          );
          const first = yield* echo.Echo({ value: "a" });
          token = "second";
          const second = yield* echo.Echo({ value: "b" });
          token = null;
          const third = yield* echo.Echo({ value: "c" });
          return [first, second, third];
        }),
      ),
    );
    expect(results).toEqual(["a", "b", "c"]);
    expect(requests).toEqual([
      {
        url: "https://host.test/base/module/macrograph.app/macrograph/twitch/rpc",
        authorization: "Bearer first",
        contentType: "application/x-ndjson",
      },
      {
        url: "https://host.test/base/module/macrograph.app/macrograph/twitch/rpc",
        authorization: "Bearer second",
        contentType: "application/x-ndjson",
      },
      {
        url: "https://host.test/base/module/macrograph.app/macrograph/twitch/rpc",
        contentType: "application/x-ndjson",
      },
    ]);
  });

  it("rejects ids that are not full module ids", async () => {
    const factory = await Effect.runPromise(
      ModuleRpcProtocol.http({ baseUrl: "https://host.test/", token: () => null }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("unreachable")),
        ),
      ),
    );
    await expect(Effect.runPromise(Effect.scoped(factory("twitch")))).rejects.toThrow(
      "The RPCs of twitch are unavailable: the id is not a full module id",
    );
  });
});
