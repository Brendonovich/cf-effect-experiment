# OpenCode Bot

Comment `/opencode <request>` or `/oc <request>` on an issue or PR. Only users with
repository write access can invoke the bot. The workflow runs `opencode2` on a
GitHub-hosted runner and asks it to respond using `gh`.

An Alchemy-deployed Cloudflare Worker receives signed GitHub `workflow_run`
webhooks. Failed `CI` runs on open, non-draft, same-repository PRs authored by
maintainers are sent to the Discord repair bot. It ignores stale failures, forks,
and runs triggered by bots. Discord link embeds are suppressed.

Configure these environment variables when running `pnpm deploy`:

- `DISCORD_AUTOFIX_WEBHOOK`: webhook for the Discord repair channel.
- `DISCORD_AUTOFIX_BOT_ID`: Discord user ID of the bot to mention.
- `GITHUB_API_TOKEN`: fine-grained token that can read PRs and collaborator access.

Production deploys from CI after validation on `main`. Configure repository Actions
secrets `DISCORD_AUTOFIX_WEBHOOK`, `DISCORD_AUTOFIX_BOT_ID`, and
`AUTOFIX_GITHUB_TOKEN`; the GitHub token must also be able to administer repository
webhooks. CI maps it to the Worker's `GITHUB_API_TOKEN` binding.

Alchemy generates and persists the webhook signing secret, then creates the Worker
and repository webhook together. Its GitHub deployment credentials need repository
webhook administration access.

## Credentials

- Secret `OPENCODE_CREDENTIAL_KEY`: random 32-byte base64 AES-256-GCM key.
- Secret `OPENCODE_VARIABLE_TOKEN`: fine-grained GitHub PAT restricted to this
  repository with **Variables: read and write** (plus mandatory Metadata: read).
- Variable `OPENCODE_CREDENTIALS`: encrypted Console access/refresh credentials.
- Secret `OPENCODE_MODEL`: confidential Console model ID in `provider/model` format.
  Keep model identities out of repository files, comments, and artifacts. Agent
  output is suppressed in Actions logs because provider metadata can also identify
  unreleased models. Only generic execution status is logged.
- Secret `OPENCODE_ORG_ID`: Console organization whose catalog supplies the model.

For first enrollment, run `pnpm --filter @macrograph/opencode-bot enroll` while
authenticated with `gh`. It generates the encryption secret and prints a Console
device link. Authorize a separate login for the bot. No plaintext credentials are
written to disk or printed. Reauthorize using the **OpenCode Console Login**
workflow on `main`; it preserves the existing encryption key.

Jobs share a concurrency group, fetch the latest encrypted variable after acquiring
the lock, and persist refreshed credentials before launching OpenCode. Only the
short-lived access token reaches the agent; the encryption key and variable-write
PAT are scoped to the credential step. Agent execution is bounded by token expiry.

GitHub concurrency retains only one pending run; a newer request may replace an
older pending request. Repost a canceled request when necessary.

The PAT expires independently of Console credentials and must be renewed. A runner
failure between Console refresh and GitHub persistence can require reenrollment.
Anyone able to modify a trusted workflow can decrypt credentials, so protect main
and review workflow changes. Maintainer-approved code can still access the job's
short-lived Console and GitHub tokens. GITHUB_TOKEN-created pushes/PRs do not trigger
normal CI workflows; repository settings must allow Actions to create pull requests.
