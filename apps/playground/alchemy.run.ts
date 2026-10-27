import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import { Layer } from "effect";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "MacroGraphPlayground",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const site = yield* Cloudflare.Website.Vite("Playground", {
      assets: {
        notFoundHandling: "single-page-application",
      },
    });

    const github = yield* GitHub.GitHubEnv;
    if (github?.pr !== undefined) {
      yield* GitHub.Comment("PlaygroundPreviewComment", {
        owner: github.owner,
        repository: github.repository,
        issueNumber: github.pr,
        body: Output.interpolate`
          ## Playground preview

          **URL:** ${site.url}

          Built from commit ${github.sha.slice(0, 7)}.
        `,
      });
    }

    return { url: site.url };
  }),
);
