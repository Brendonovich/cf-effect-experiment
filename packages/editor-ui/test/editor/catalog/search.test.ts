import { describe, expect, it } from "vitest";

import { rankedSearch, searchScore, tokenizeSearch } from "../../../src/editor/catalog/search";

const docs = [
  { item: "websocket", key: "b", fields: ["WebSocket Client", "ws-client"] },
  { item: "webhook", key: "a", fields: ["Webhook Client"] },
];

describe("tokenized ranked search", () => {
  it("tokenizes punctuation, camel case, and whitespace", () => {
    expect(tokenizeSearch("  HTTP/webSocket-client_v2 ")).toEqual([
      "http",
      "web",
      "socket",
      "client",
      "v",
      "2",
    ]);
    expect(tokenizeSearch("Über Straße/東京")).toEqual(["über", "straße", "東京"]);
  });

  it("matches acronyms", () => {
    expect(searchScore("wsc", ["WebSocket Client"])).toBeGreaterThan(0);
    expect(rankedSearch("wsc", docs)).toEqual(["websocket"]);
  });

  it("keeps all results for an empty search", () => {
    expect(rankedSearch("", docs)).toEqual(["webhook", "websocket"]);
  });

  it("ranks exact tokens above partial matches", () => {
    expect(rankedSearch("websocket", docs)[0]).toBe("websocket");
  });

  it("breaks score ties deterministically by key", () => {
    expect(
      rankedSearch("client", [
        { item: "second", key: "z", fields: ["Client"] },
        { item: "first", key: "a", fields: ["Client"] },
      ]),
    ).toEqual(["first", "second"]);
  });
});
