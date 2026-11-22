import * as Api from "@macrograph/module-github/Api";
import { Effect } from "effect";

import type { Provider } from "../Provider.ts";

import { InvalidInput, type PropertySchema, snakeCase, type Tool } from "../Tool.ts";

export const provider: Provider = {
  id: "github",
  displayName: "GitHub",
  baseUrl: "https://api.github.com",
  headers: ({ accessToken }) => ({
    authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "MacroGraph",
  }),
};

type ActionId = Parameters<typeof Api.prepare>[0];

const owner: PropertySchema = { type: "string", minLength: 1, description: "Repository owner" };
const repository: PropertySchema = { type: "string", minLength: 1, description: "Repository name" };
const perPage: PropertySchema = {
  type: "integer",
  minimum: 1,
  maximum: 100,
  default: 30,
  description: "Results per page",
};
const number: PropertySchema = { type: "integer", minimum: 1, description: "Issue or PR number" };
const listState: PropertySchema = {
  type: "string",
  enum: ["open", "closed", "all"],
  default: "open",
  description: "Filter by state",
};

interface Definition {
  readonly id: ActionId;
  readonly title: string;
  readonly description: string;
  readonly properties: Readonly<Record<string, PropertySchema>>;
  readonly required: ReadonlyArray<string>;
}

const repo = { owner, repository };
const definitions: ReadonlyArray<Definition> = [
  {
    id: "get-repository",
    title: "Get Repository",
    description: "Get a repository's details.",
    properties: repo,
    required: [],
  },
  {
    id: "list-branches",
    title: "List Branches",
    description: "List a repository's branches.",
    properties: { ...repo, perPage },
    required: [],
  },
  {
    id: "list-commits",
    title: "List Commits",
    description: "List a repository's commits, newest first.",
    properties: {
      ...repo,
      ref: { type: "string", description: "Branch, tag, or SHA to list from" },
      perPage,
    },
    required: [],
  },
  {
    id: "list-releases",
    title: "List Releases",
    description: "List a repository's releases.",
    properties: { ...repo, perPage },
    required: [],
  },
  {
    id: "list-contributors",
    title: "List Contributors",
    description: "List a repository's contributors.",
    properties: { ...repo, perPage },
    required: [],
  },
  {
    id: "list-issues",
    title: "List Issues",
    description: "List a repository's issues, including pull requests.",
    properties: { ...repo, state: listState, perPage },
    required: [],
  },
  {
    id: "get-issue",
    title: "Get Issue",
    description: "Get an issue by number.",
    properties: { ...repo, number },
    required: ["number"],
  },
  {
    id: "create-issue",
    title: "Create Issue",
    description: "Open a new issue.",
    properties: {
      ...repo,
      title: { type: "string", minLength: 1, description: "Issue title" },
      body: { type: "string", description: "Issue body (Markdown)" },
    },
    required: ["title"],
  },
  {
    id: "update-issue",
    title: "Update Issue",
    description: "Change an issue's title, body, or state. Omitted fields are left unchanged.",
    properties: {
      ...repo,
      number,
      title: { type: "string", description: "New title" },
      body: { type: "string", description: "New body (Markdown)" },
      state: { type: "string", enum: ["open", "closed"], description: "New state" },
    },
    required: ["number"],
  },
  {
    id: "list-pull-requests",
    title: "List Pull Requests",
    description: "List a repository's pull requests.",
    properties: { ...repo, state: listState, perPage },
    required: [],
  },
  {
    id: "get-pull-request",
    title: "Get Pull Request",
    description: "Get a pull request by number.",
    properties: { ...repo, number },
    required: ["number"],
  },
  {
    id: "create-comment",
    title: "Create Comment",
    description: "Comment on an issue or pull request.",
    properties: {
      ...repo,
      number,
      body: { type: "string", minLength: 1, description: "Comment body (Markdown)" },
    },
    required: ["number", "body"],
  },
];

const toTool = (definition: Definition): Tool => {
  const method = Api.prepare(definition.id, {
    owner: "owner",
    repository: "repository",
    number: 1,
    title: "title",
    body: "body",
    state: "open",
  }).method;
  return {
    name: `github_${snakeCase(definition.id)}`,
    provider: provider.id,
    title: definition.title,
    description: `${definition.description} (GitHub ${method}).`,
    method,
    readOnly: method === "GET",
    scopes: [],
    inputSchema: {
      type: "object",
      properties: definition.properties,
      required: ["owner", "repository", ...definition.required],
      additionalProperties: false,
    },
    prepare: (inputs) =>
      Effect.try({
        try: () =>
          Api.prepare(definition.id, {
            ...("state" in definition.properties && definition.id !== "update-issue"
              ? { state: "open" }
              : {}),
            ...inputs,
          }),
        catch: (error) =>
          new InvalidInput({
            message:
              typeof error === "object" && error !== null && "reason" in error
                ? String(error.reason)
                : "Invalid GitHub inputs",
          }),
      }),
  };
};

export const tools: ReadonlyArray<Tool> = definitions.map(toTool);
