import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import { Config, Effect, Layer, Redacted } from "effect";

import { processWorkflowRun, repositoryName, repositoryOwner } from "./workflow-run.ts";

const DiscordWebhook = Config.redacted("DISCORD_AUTOFIX_WEBHOOK");
const DiscordBotId = Config.string("DISCORD_AUTOFIX_BOT_ID");
const GitHubToken = Config.redacted("GITHUB_API_TOKEN");

const boundString = (value: unknown): string | undefined => {
  let current = value;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "string") return undefined;
    try {
      const parsed: unknown = JSON.parse(current);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "_tag" in parsed &&
        parsed._tag === "Redacted" &&
        "value" in parsed
      ) {
        current = parsed.value;
        continue;
      }
      if (typeof parsed === "string") {
        current = parsed;
        continue;
      }
      return current;
    } catch {
      return typeof current === "string" ? current : undefined;
    }
  }
  return typeof current === "string" ? current : undefined;
};

export class AutofixWorker extends Cloudflare.Worker<AutofixWorker, {}>()("AutofixWorker") {}

export default Layer.unwrap(
  Effect.gen(function* () {
    const generatedWebhookSecret = yield* Alchemy.Random("GitHubWebhookSecret", { bytes: 32 });
    return AutofixWorker.make(
      {
        main: import.meta.url,
        env: {
          DISCORD_AUTOFIX_WEBHOOK: DiscordWebhook,
          DISCORD_AUTOFIX_BOT_ID: DiscordBotId,
          GITHUB_API_TOKEN: GitHubToken,
        },
        dev: { port: 1340, strictPort: true },
      },
      Effect.gen(function* () {
        const environment = yield* Cloudflare.WorkerEnvironment;
        const discordWebhook =
          boundString(environment.DISCORD_AUTOFIX_WEBHOOK) ?? Redacted.value(yield* DiscordWebhook);
        const botUserId = boundString(environment.DISCORD_AUTOFIX_BOT_ID) ?? (yield* DiscordBotId);
        const githubToken =
          boundString(environment.GITHUB_API_TOKEN) ?? Redacted.value(yield* GitHubToken);
        return yield* Effect.gen(function* () {
          const credentials = yield* yield* GitHub.GitHubCredentials;
          const octokit = credentials.octokit();

          yield* GitHub.consumeRepositoryEvents(
            {
              owner: repositoryOwner,
              repository: repositoryName,
              events: ["workflow_run"],
              // The runtime accepts an Output here so it can preserve the generated
              // secret's redacted marker, though the current public type is narrower.
              secret: generatedWebhookSecret.text as unknown as Redacted.Redacted<string>,
            },
            (event) =>
              event.name !== "workflow_run"
                ? Effect.void
                : Effect.promise(async () => {
                    const decision = await processWorkflowRun(event.payload, {
                      botUserId,
                      discordWebhook,
                      github: {
                        getPull: (pullNumber) =>
                          octokit.rest.pulls
                            .get({
                              owner: repositoryOwner,
                              repo: repositoryName,
                              pull_number: pullNumber,
                            })
                            .then(({ data }) => data),
                        getCollaboratorPermission: (username) =>
                          octokit.rest.repos
                            .getCollaboratorPermissionLevel({
                              owner: repositoryOwner,
                              repo: repositoryName,
                              username,
                            })
                            .then(({ data }) => data),
                      },
                    });
                    console.log(`GitHub workflow run decision: ${decision}`);
                  }),
          );

          return {};
        }).pipe(Effect.provide(GitHub.fromToken(githubToken)));
      }).pipe(Effect.provide(Cloudflare.Workers.GitHubRepositoryEventSourceLive)),
    );
  }),
);
