# GitHub

GitHub REST and repository-webhook integration for MacroGraph.

The module uses connected `github` OAuth credentials; tokens stay in the host credential service and are never exposed as graph inputs or module client state. REST nodes cover repository details, branches, commits, releases, contributors, issues, pull requests, and issue/pull-request comments. Responses are returned as JSON strings with the HTTP status code.

MacroGraph Cloud settings can provision signed repository webhooks for `push`, `pull_request`, `issues`, `issue_comment`, `workflow_run`, and `release`. The provider webhook uses a per-endpoint HMAC-SHA256 secret. Deliveries expose normalized repository, sender, action, and delivery fields plus the complete JSON payload.

The selected credential needs access to the repository and permission to manage repository webhooks. For fine-grained tokens, grant the relevant repository read/write permissions and **Webhooks: read and write**. GitHub REST calls made while editing use the connected OAuth credential. Cloud workflow REST calls are currently unavailable because deployed workflows do not receive session-scoped OAuth credentials; webhook event graphs can still process and route delivery data.
