import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Alchemy from "alchemy";
import { Layer } from "effect";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "MacroGraphPlayground",
  {
    // The GitHub provider stays registered so previews can delete the comment they used to post.
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
