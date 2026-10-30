import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Alchemy from "alchemy";
import { Layer } from "effect";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "MacroGraphPlayground",
  {
    // Stays registered so stages that still track the old preview comment can drop it from state;
    // GitHub.Comment keeps the comment itself on removal.
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const site = yield* Cloudflare.Website.Vite("Playground", {
      assets: {
        notFoundHandling: "single-page-application",
      },
    });

    return { url: site.url };
  }),
);
