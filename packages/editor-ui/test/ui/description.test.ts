import { describe, expect, it } from "vitest";

import { descriptionSegments, plainDescription } from "../../src/ui/Description";

describe("description links", () => {
  it("splits markdown links out of surrounding text", () => {
    expect(
      descriptionSegments("Sends a message. [Twitch docs](https://dev.twitch.tv/docs/a#b) Done."),
    ).toEqual([
      { text: "Sends a message. " },
      { text: "Twitch docs", href: "https://dev.twitch.tv/docs/a#b" },
      { text: " Done." },
    ]);
  });

  it("leaves non-http links and plain text as text", () => {
    expect(descriptionSegments("[x](javascript:alert(1)) plain")).toEqual([
      { text: "[x](javascript:alert(1)) plain" },
    ]);
    expect(descriptionSegments("")).toEqual([]);
  });

  it("reduces links to their text for tooltips and search", () => {
    expect(plainDescription("Sends a message. [Twitch docs](https://dev.twitch.tv/docs/a)")).toBe(
      "Sends a message. Twitch docs",
    );
  });
});
