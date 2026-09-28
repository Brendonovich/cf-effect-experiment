import type * as Engine from "@macrograph/module/Engine";

import { DataType, Module } from "@macrograph/module";
import { Effect, Option, Schema } from "effect";

import {
  GitHubAccount,
  GitHubEngine,
  GitHubWebhook,
  type AccountId,
  type ActionId,
  type WebhookEventName,
} from "./Definition.ts";
import { WebhookPayloadTypes, WebhookTypeDefinitions } from "./WebhookTypes.ts";

const preparePayload = (
  type: DataType.Any,
  value: Schema.Json,
  definitions: DataType.Definitions,
): unknown => {
  if (type._tag === "List")
    return Array.isArray(value)
      ? value.map((item) => preparePayload(type.item, item, definitions))
      : value;
  if (type._tag === "Option")
    return value === null
      ? Option.none()
      : Option.some(preparePayload(type.inner, value, definitions));
  if (type._tag === "DateTime") {
    const decoded = Schema.decodeUnknownOption(
      Schema.Union([Schema.DateTimeUtc, Schema.DateTimeZoned]),
    )(value);
    return Option.isSome(decoded) ? decoded.value : value;
  }
  if (type._tag !== "Custom") return value;

  const definition = Object.hasOwn(definitions, type.id) ? definitions[type.id] : undefined;
  if (definition === undefined) return value;
  if (definition._tag === "Enum") {
    if (typeof value === "string" && definition.variants.some((variant) => variant.name === value))
      return { _type: definition.id, _tag: value };
    if (!isJsonObject(value)) return value;
    const tag = value["_tag"];
    const variant = definition.variants.find((candidate) => candidate.name === tag);
    if (variant === undefined) return value;
    return {
      _type: definition.id,
      _tag: tag,
      ...Object.fromEntries(
        variant.fields.map((field) => [
          field.name,
          Object.hasOwn(value, field.name)
            ? preparePayload(field.type, value[field.name]!, definitions)
            : null,
        ]),
      ),
    };
  }
  if (!isJsonObject(value)) return value;
  return {
    _type: definition.id,
    ...Object.fromEntries(
      definition.fields.map((field) => [
        field.name,
        Object.hasOwn(value, field.name)
          ? preparePayload(field.type, value[field.name]!, definitions)
          : null,
      ]),
    ),
  };
};

const isJsonObject = (value: Schema.Json): value is { readonly [key: string]: Schema.Json } =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const GitHubModule = Module.make({
  id: "github",
  name: "GitHub",
  engine: GitHubEngine,
  types: WebhookTypeDefinitions,
  effect: Effect.fnUntraced(function* (ctx) {
    const request = (
      engine: Engine.RuntimeClientOf<typeof GitHubEngine>,
      accountId: AccountId,
      action: ActionId,
      inputs: Readonly<Record<string, string | number>>,
      status: (value: number) => void,
      response: (value: string) => void,
    ) =>
      engine
        .GitHubRequest({
          accountId,
          action,
          inputs,
        })
        .pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              status(result.status);
              response(JSON.stringify(result.body));
            }),
          ),
          Effect.asVoid,
        );

    yield* ctx.schema.register({
      id: "GetRepository",
      name: "Get Repository",
      properties: { account: { name: "Account", resource: GitHubAccount } },
      io: (io) => ({
        owner: io.data.in("owner", DataType.String, { name: "Owner" }),
        repository: io.data.in("repository", DataType.String, { name: "Repository" }),
        status: io.data.out("status", DataType.Int, { name: "Status" }),
        response: io.data.out("response", DataType.String, { name: "Response JSON" }),
      }),
      run: ({ io, engine, properties }) =>
        request(
          engine,
          properties.account,
          "get-repository",
          { owner: io.owner, repository: io.repository },
          io.status,
          io.response,
        ),
    });

    for (const definition of [
      { id: "ListBranches", name: "List Branches", action: "list-branches" },
      { id: "ListReleases", name: "List Releases", action: "list-releases" },
      { id: "ListContributors", name: "List Contributors", action: "list-contributors" },
    ] as const) {
      yield* ctx.schema.register({
        id: definition.id,
        name: definition.name,
        properties: { account: { name: "Account", resource: GitHubAccount } },
        io: (io) => ({
          owner: io.data.in("owner", DataType.String, { name: "Owner" }),
          repository: io.data.in("repository", DataType.String, { name: "Repository" }),
          perPage: io.data.in("perPage", DataType.Int, { name: "Per Page", defaultValue: 30 }),
          status: io.data.out("status", DataType.Int, { name: "Status" }),
          response: io.data.out("response", DataType.String, { name: "Response JSON" }),
        }),
        run: ({ io, engine, properties }) =>
          request(
            engine,
            properties.account,
            definition.action,
            { owner: io.owner, repository: io.repository, perPage: io.perPage },
            io.status,
            io.response,
          ),
      });
    }

    yield* ctx.schema.register({
      id: "ListCommits",
      name: "List Commits",
      properties: { account: { name: "Account", resource: GitHubAccount } },
      io: (io) => ({
        owner: io.data.in("owner", DataType.String, { name: "Owner" }),
        repository: io.data.in("repository", DataType.String, { name: "Repository" }),
        ref: io.data.in("ref", DataType.String, { name: "Branch or SHA", defaultValue: "" }),
        perPage: io.data.in("perPage", DataType.Int, { name: "Per Page", defaultValue: 30 }),
        status: io.data.out("status", DataType.Int, { name: "Status" }),
        response: io.data.out("response", DataType.String, { name: "Response JSON" }),
      }),
      run: ({ io, engine, properties }) =>
        request(
          engine,
          properties.account,
          "list-commits",
          { owner: io.owner, repository: io.repository, ref: io.ref, perPage: io.perPage },
          io.status,
          io.response,
        ),
    });

    for (const definition of [
      { id: "ListIssues", name: "List Issues", action: "list-issues" },
      { id: "ListPullRequests", name: "List Pull Requests", action: "list-pull-requests" },
    ] as const) {
      yield* ctx.schema.register({
        id: definition.id,
        name: definition.name,
        properties: { account: { name: "Account", resource: GitHubAccount } },
        io: (io) => ({
          owner: io.data.in("owner", DataType.String, { name: "Owner" }),
          repository: io.data.in("repository", DataType.String, { name: "Repository" }),
          state: io.data.in("state", DataType.String, { name: "State", defaultValue: "open" }),
          perPage: io.data.in("perPage", DataType.Int, { name: "Per Page", defaultValue: 30 }),
          status: io.data.out("status", DataType.Int, { name: "Status" }),
          response: io.data.out("response", DataType.String, { name: "Response JSON" }),
        }),
        run: ({ io, engine, properties }) =>
          request(
            engine,
            properties.account,
            definition.action,
            { owner: io.owner, repository: io.repository, state: io.state, perPage: io.perPage },
            io.status,
            io.response,
          ),
      });
    }

    for (const definition of [
      { id: "GetIssue", name: "Get Issue", action: "get-issue" },
      { id: "GetPullRequest", name: "Get Pull Request", action: "get-pull-request" },
    ] as const) {
      yield* ctx.schema.register({
        id: definition.id,
        name: definition.name,
        properties: { account: { name: "Account", resource: GitHubAccount } },
        io: (io) => ({
          owner: io.data.in("owner", DataType.String, { name: "Owner" }),
          repository: io.data.in("repository", DataType.String, { name: "Repository" }),
          number: io.data.in("number", DataType.Int, { name: "Number" }),
          status: io.data.out("status", DataType.Int, { name: "Status" }),
          response: io.data.out("response", DataType.String, { name: "Response JSON" }),
        }),
        run: ({ io, engine, properties }) =>
          request(
            engine,
            properties.account,
            definition.action,
            { owner: io.owner, repository: io.repository, number: io.number },
            io.status,
            io.response,
          ),
      });
    }

    yield* ctx.schema.register({
      id: "CreateIssue",
      name: "Create Issue",
      properties: { account: { name: "Account", resource: GitHubAccount } },
      io: (io) => ({
        owner: io.data.in("owner", DataType.String, { name: "Owner" }),
        repository: io.data.in("repository", DataType.String, { name: "Repository" }),
        title: io.data.in("title", DataType.String, { name: "Title" }),
        body: io.data.in("body", DataType.String, { name: "Body", defaultValue: "" }),
        status: io.data.out("status", DataType.Int, { name: "Status" }),
        response: io.data.out("response", DataType.String, { name: "Response JSON" }),
      }),
      run: ({ io, engine, properties }) =>
        request(
          engine,
          properties.account,
          "create-issue",
          { owner: io.owner, repository: io.repository, title: io.title, body: io.body },
          io.status,
          io.response,
        ),
    });

    yield* ctx.schema.register({
      id: "UpdateIssue",
      name: "Update Issue",
      description: "Updates the non-empty fields on an issue.",
      properties: { account: { name: "Account", resource: GitHubAccount } },
      io: (io) => ({
        owner: io.data.in("owner", DataType.String, { name: "Owner" }),
        repository: io.data.in("repository", DataType.String, { name: "Repository" }),
        number: io.data.in("number", DataType.Int, { name: "Number" }),
        title: io.data.in("title", DataType.String, { name: "Title", defaultValue: "" }),
        body: io.data.in("body", DataType.String, { name: "Body", defaultValue: "" }),
        state: io.data.in("state", DataType.String, { name: "State", defaultValue: "" }),
        status: io.data.out("status", DataType.Int, { name: "Status" }),
        response: io.data.out("response", DataType.String, { name: "Response JSON" }),
      }),
      run: ({ io, engine, properties }) =>
        request(
          engine,
          properties.account,
          "update-issue",
          {
            owner: io.owner,
            repository: io.repository,
            number: io.number,
            title: io.title,
            body: io.body,
            state: io.state,
          },
          io.status,
          io.response,
        ),
    });

    yield* ctx.schema.register({
      id: "CreateComment",
      name: "Create Issue or Pull Request Comment",
      properties: { account: { name: "Account", resource: GitHubAccount } },
      io: (io) => ({
        owner: io.data.in("owner", DataType.String, { name: "Owner" }),
        repository: io.data.in("repository", DataType.String, { name: "Repository" }),
        number: io.data.in("number", DataType.Int, { name: "Issue or Pull Request Number" }),
        body: io.data.in("body", DataType.String, { name: "Body" }),
        status: io.data.out("status", DataType.Int, { name: "Status" }),
        response: io.data.out("response", DataType.String, { name: "Response JSON" }),
      }),
      run: ({ io, engine, properties }) =>
        request(
          engine,
          properties.account,
          "create-comment",
          { owner: io.owner, repository: io.repository, number: io.number, body: io.body },
          io.status,
          io.response,
        ),
    });

    const webhookEvents: ReadonlyArray<{
      readonly event: WebhookEventName;
      readonly id: string;
      readonly name: string;
    }> = [
      { event: "push", id: "webhook:push", name: "Push" },
      { event: "pull_request", id: "webhook:pull-request", name: "Pull Request" },
      { event: "issues", id: "webhook:issues", name: "Issue" },
      { event: "issue_comment", id: "webhook:issue-comment", name: "Issue Comment" },
      { event: "workflow_run", id: "webhook:workflow-run", name: "Workflow Run" },
      { event: "release", id: "webhook:release", name: "Release" },
    ];
    for (const definition of webhookEvents) {
      yield* ctx.schema.register({
        id: definition.id,
        name: `${definition.name} Webhook`,
        type: "event",
        properties: { webhook: { name: "Repository Webhook", resource: GitHubWebhook } },
        event: (event, { properties }) =>
          Effect.succeed(
            event.event === definition.event && event.webhookId === properties.webhook,
          ),
        io: (io) => ({
          action: io.data.out("action", DataType.String, { name: "Action" }),
          owner: io.data.out("owner", DataType.String, { name: "Owner" }),
          repository: io.data.out("repository", DataType.String, { name: "Repository" }),
          sender: io.data.out("sender", DataType.String, { name: "Sender" }),
          deliveryId: io.data.out("deliveryId", DataType.String, { name: "Delivery ID" }),
          payload: io.data.out("payload", WebhookPayloadTypes[definition.event], {
            name: "Payload",
          }),
          payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
        }),
        run: ({ event, io, types }) =>
          Effect.gen(function* () {
            if (event === undefined) return;
            io.action(event.action);
            io.owner(event.owner);
            io.repository(event.repository);
            io.sender(event.sender);
            io.deliveryId(event.deliveryId);
            io.payloadJson(JSON.stringify(event.payload));
            const payloadType = WebhookPayloadTypes[definition.event];
            const payload = yield* Schema.decodeUnknownEffect(
              DataType.ValueSchema(payloadType, types.definitions),
            )(preparePayload(payloadType, event.payload, types.definitions));
            if (typeof payload === "object" && payload !== null && !Array.isArray(payload))
              io.payload(payload as Readonly<Record<string, unknown>>);
          }),
      });
    }
  }),
});

export default GitHubModule;
