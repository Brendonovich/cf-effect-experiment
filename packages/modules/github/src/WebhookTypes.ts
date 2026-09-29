import { t } from "@macrograph/module";

const User = t.defineStruct("github/User", "GitHub User", {
  login: t.String,
  id: t.Int,
  type: t.String,
  html_url: t.String,
});

const Installation = t.defineStruct("github/Installation", "GitHub Installation", { id: t.Int });

const Repository = t.defineStruct("github/Repository", "GitHub Repository", {
  id: t.Int,
  name: t.String,
  full_name: t.String,
  private: t.Bool,
  html_url: t.String,
  default_branch: t.String,
});

const CommitAuthor = t.defineStruct("github/CommitAuthor", "GitHub CommitAuthor", {
  name: t.String,
  email: t.String,
  username: t.Option(t.String),
});

const PushCommit = t.defineStruct("github/PushCommit", "GitHub PushCommit", {
  id: t.String,
  message: t.String,
  timestamp: t.DateTime,
  url: t.String,
  author: t.Struct(CommitAuthor),
  committer: t.Struct(CommitAuthor),
  added: t.List(t.String),
  removed: t.List(t.String),
  modified: t.List(t.String),
});

const Pusher = t.defineStruct("github/Pusher", "GitHub Pusher", {
  name: t.String,
  email: t.Option(t.String),
});

const BranchReference = t.defineStruct("github/BranchReference", "GitHub BranchReference", {
  label: t.String,
  ref: t.String,
  sha: t.String,
  user: t.Struct(User),
  repo: t.Option(t.Struct(Repository)),
});

const PullRequest = t.defineStruct("github/PullRequest", "GitHub PullRequest", {
  id: t.Int,
  number: t.Int,
  state: t.String,
  locked: t.Bool,
  title: t.String,
  body: t.Option(t.String),
  html_url: t.String,
  draft: t.Bool,
  merged: t.Bool,
  mergeable: t.Option(t.Bool),
  user: t.Struct(User),
  head: t.Struct(BranchReference),
  base: t.Struct(BranchReference),
});

const Issue = t.defineStruct("github/Issue", "GitHub Issue", {
  id: t.Int,
  number: t.Int,
  state: t.String,
  locked: t.Bool,
  title: t.String,
  body: t.Option(t.String),
  html_url: t.String,
  user: t.Struct(User),
});

const IssueComment = t.defineStruct("github/IssueComment", "GitHub IssueComment", {
  id: t.Int,
  body: t.String,
  html_url: t.String,
  user: t.Struct(User),
  created_at: t.DateTime,
  updated_at: t.DateTime,
});

const Workflow = t.defineStruct("github/Workflow", "GitHub Workflow", {
  id: t.Int,
  name: t.String,
  path: t.String,
  state: t.String,
  html_url: t.String,
});

const WorkflowRun = t.defineStruct("github/WorkflowRun", "GitHub WorkflowRun", {
  id: t.Int,
  name: t.Option(t.String),
  event: t.String,
  status: t.Option(t.String),
  conclusion: t.Option(t.String),
  head_branch: t.Option(t.String),
  head_sha: t.String,
  html_url: t.String,
});

const Release = t.defineStruct("github/Release", "GitHub Release", {
  id: t.Int,
  tag_name: t.String,
  target_commitish: t.String,
  name: t.Option(t.String),
  body: t.Option(t.String),
  draft: t.Bool,
  prerelease: t.Bool,
  html_url: t.String,
  author: t.Struct(User),
});

const PullRequestAction = t.defineEnum("github/PullRequestAction", "GitHub PullRequestAction", [
  "assigned",
  "auto_merge_disabled",
  "auto_merge_enabled",
  "closed",
  "converted_to_draft",
  "demilestoned",
  "dequeued",
  "edited",
  "enqueued",
  "labeled",
  "locked",
  "milestoned",
  "opened",
  "ready_for_review",
  "reopened",
  "review_request_removed",
  "review_requested",
  "synchronize",
  "unassigned",
  "unlabeled",
  "unlocked",
]);

const IssueAction = t.defineEnum("github/IssueAction", "GitHub IssueAction", [
  "assigned",
  "closed",
  "deleted",
  "demilestoned",
  "edited",
  "labeled",
  "locked",
  "milestoned",
  "opened",
  "pinned",
  "reopened",
  "transferred",
  "unassigned",
  "unlabeled",
  "unlocked",
  "unpinned",
  "typed",
  "untyped",
]);

const IssueCommentAction = t.defineEnum("github/IssueCommentAction", "GitHub IssueCommentAction", [
  "created",
  "deleted",
  "edited",
]);

const WorkflowRunAction = t.defineEnum("github/WorkflowRunAction", "GitHub WorkflowRunAction", [
  "completed",
  "in_progress",
  "requested",
]);

const ReleaseAction = t.defineEnum("github/ReleaseAction", "GitHub ReleaseAction", [
  "created",
  "deleted",
  "edited",
  "prereleased",
  "published",
  "released",
  "unpublished",
]);

const PushPayload = t.defineStruct("github/PushPayload", "GitHub PushPayload", {
  ref: t.String,
  before: t.String,
  after: t.String,
  created: t.Bool,
  deleted: t.Bool,
  forced: t.Bool,
  compare: t.String,
  commits: t.List(t.Struct(PushCommit)),
  head_commit: t.Option(t.Struct(PushCommit)),
  pusher: t.Struct(Pusher),
  repository: t.Struct(Repository),
  sender: t.Struct(User),
  installation: t.Struct(Installation),
});

const PullRequestPayload = t.defineStruct(
  "github/PullRequestPayload",
  "GitHub PullRequestPayload",
  {
    action: t.Enum(PullRequestAction),
    number: t.Int,
    pull_request: t.Struct(PullRequest),
    repository: t.Struct(Repository),
    sender: t.Struct(User),
    installation: t.Struct(Installation),
  },
);

const IssuesPayload = t.defineStruct("github/IssuesPayload", "GitHub IssuesPayload", {
  action: t.Enum(IssueAction),
  issue: t.Struct(Issue),
  repository: t.Struct(Repository),
  sender: t.Struct(User),
  installation: t.Struct(Installation),
});

const IssueCommentPayload = t.defineStruct(
  "github/IssueCommentPayload",
  "GitHub IssueCommentPayload",
  {
    action: t.Enum(IssueCommentAction),
    issue: t.Struct(Issue),
    comment: t.Struct(IssueComment),
    repository: t.Struct(Repository),
    sender: t.Struct(User),
    installation: t.Struct(Installation),
  },
);

const WorkflowRunPayload = t.defineStruct(
  "github/WorkflowRunPayload",
  "GitHub WorkflowRunPayload",
  {
    action: t.Enum(WorkflowRunAction),
    workflow: t.Struct(Workflow),
    workflow_run: t.Struct(WorkflowRun),
    repository: t.Struct(Repository),
    sender: t.Struct(User),
    installation: t.Struct(Installation),
  },
);

const ReleasePayload = t.defineStruct("github/ReleasePayload", "GitHub ReleasePayload", {
  action: t.Enum(ReleaseAction),
  release: t.Struct(Release),
  repository: t.Struct(Repository),
  sender: t.Struct(User),
  installation: t.Struct(Installation),
});

const definitions = [
  User,
  Installation,
  Repository,
  CommitAuthor,
  PushCommit,
  Pusher,
  BranchReference,
  PullRequest,
  Issue,
  IssueComment,
  Workflow,
  WorkflowRun,
  Release,
  PullRequestAction,
  IssueAction,
  IssueCommentAction,
  WorkflowRunAction,
  ReleaseAction,
  PushPayload,
  PullRequestPayload,
  IssuesPayload,
  IssueCommentPayload,
  WorkflowRunPayload,
  ReleasePayload,
] as const;

export const WebhookTypeDefinitions: t.Definitions = Object.fromEntries(
  definitions.map((definition) => [definition.id, definition]),
);

export const WebhookPayloadTypes = {
  push: t.Struct(PushPayload),
  pull_request: t.Struct(PullRequestPayload),
  issues: t.Struct(IssuesPayload),
  issue_comment: t.Struct(IssueCommentPayload),
  workflow_run: t.Struct(WorkflowRunPayload),
  release: t.Struct(ReleasePayload),
} satisfies Readonly<Record<string, t.Struct>>;
