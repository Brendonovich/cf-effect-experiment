# OpenCode Bot

Comment `/opencode <request>` or `/oc <request>` on an issue or PR. Only users with
repository write access can invoke the bot. The workflow runs `opencode2` on a
GitHub-hosted runner and asks it to respond using `gh`.

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
