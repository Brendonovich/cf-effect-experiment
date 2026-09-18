import { notifyDiscord } from "./notify-discord.ts";

export const repositoryOwner = "Brendonovich";
export const repositoryName = "cf-effect-experiment";
export const repository = `${repositoryOwner}/${repositoryName}`;

export interface AutofixConfig {
  readonly botUserId: string;
  readonly discordWebhook: string;
  readonly github: {
    readonly getPull: (pullNumber: number) => Promise<unknown>;
    readonly getCollaboratorPermission: (username: string) => Promise<unknown>;
  };
}

export type Decision =
  | "not-completed"
  | "not-ci"
  | "not-failed"
  | "not-pull-request"
  | "bot-triggered"
  | "no-pull-request"
  | "wrong-repository"
  | "closed-or-fork"
  | "draft"
  | "stale-run"
  | "not-maintainer"
  | "notified";

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

export async function processWorkflowRun(
  payload: unknown,
  config: AutofixConfig,
  request: typeof fetch = fetch,
): Promise<Decision> {
  const root = object(payload);
  if (root?.action !== "completed") return "not-completed";

  const run = object(root.workflow_run);
  if (run?.name !== "CI") return "not-ci";
  if (run.conclusion !== "failure") return "not-failed";
  if (run.event !== "pull_request") return "not-pull-request";
  if (object(run.actor)?.type === "Bot") return "bot-triggered";

  const references = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  const reference = object(references[0]);
  const number = reference?.number;
  if (typeof number !== "number" || !Number.isInteger(number)) return "no-pull-request";
  if (object(root.repository)?.full_name !== repository) return "wrong-repository";

  const pull = object(await config.github.getPull(number));
  const head = object(pull?.head);
  const author = object(pull?.user)?.login;
  if (
    pull?.state !== "open" ||
    object(head?.repo)?.full_name !== repository ||
    typeof author !== "string"
  ) {
    return "closed-or-fork";
  }
  if (pull.draft !== false) return "draft";
  if (head?.sha !== run.head_sha) return "stale-run";

  const access = object(await config.github.getCollaboratorPermission(author));
  if (!new Set(["admin", "maintain", "write"]).has(access?.permission as string)) {
    return "not-maintainer";
  }

  if (typeof pull.html_url !== "string" || typeof run.html_url !== "string") {
    throw new Error("GitHub returned an invalid PR or workflow run URL");
  }
  await notifyDiscord(
    config.discordWebhook,
    {
      botUserId: config.botUserId,
      repository,
      pullRequestUrl: pull.html_url,
      workflowRunUrl: run.html_url,
    },
    request,
  );
  return "notified";
}
