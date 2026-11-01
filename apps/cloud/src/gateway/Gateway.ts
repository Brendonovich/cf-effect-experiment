import {
  Catalog,
  Execute,
  defaultPolicy,
  type Inputs,
  type Policy,
  type Tool,
} from "@macrograph/gateway";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import { Config, Context, Effect, Layer, Schema } from "effect";
import { HttpClient } from "effect/http";

import type { oauthCredentials } from "../database/AccountDatabaseSchema.ts";

import * as CredentialStore from "../auth/CredentialStore.ts";
import * as OAuthProviders from "../auth/OAuthProviders.ts";
import * as Database from "../database/Database.ts";
import {
  type GatewayApprovalStatus,
  gatewayApprovals,
  gatewayToolPolicies,
} from "../database/DatabaseSchema.ts";

/** How long a call waits for its user before it lapses. */
const approvalLifetimeMs = 10 * 60 * 1000;
const pollIntervalMs = 1_500;

const isInputs = Schema.is(Schema.Record(Schema.String, Schema.Json));

export interface Account {
  readonly provider: string;
  readonly id: string;
  readonly displayName: string | null;
}

export interface ToolState {
  readonly tool: Tool;
  readonly policy: Policy;
  readonly defaultPolicy: Policy;
}

export interface Approval {
  readonly id: string;
  readonly tool: string;
  readonly title: string;
  readonly provider: string;
  readonly account: { readonly id: string; readonly displayName: string | null };
  readonly arguments: Inputs;
  readonly caller: string | null;
  readonly status: GatewayApprovalStatus;
  readonly result: Execute.Response | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt: string | null;
  readonly completedAt: string | null;
}

/** What became of a call: run now, refused, or waiting for the user. */
export type Outcome =
  | { readonly _tag: "Completed"; readonly response: Execute.Response }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Approval"; readonly approval: Approval };

type CredentialRow = typeof oauthCredentials.$inferSelect;
type ApprovalRow = typeof gatewayApprovals.$inferSelect;

const failed = (message: string): Outcome => ({ _tag: "Failed", message });

/** Whether a request ran, answering the agent as completed even when the provider refused. */
const toOutcome = (result: { readonly response: Execute.Response } | { readonly error: string }) =>
  "error" in result
    ? failed(result.error)
    : ({ _tag: "Completed", response: result.response } satisfies Outcome);

export class Service extends Context.Service<
  Service,
  {
    /** Whether the user may use the gateway at all, while it is limited to `GATEWAY_ALLOWED_USERS`. */
    readonly allows: (userId: string) => boolean;
    readonly accounts: (userId: string) => Effect.Effect<ReadonlyArray<Account>>;
    readonly tools: (userId: string) => Effect.Effect<ReadonlyArray<ToolState>>;
    /** Returns `false` for an unknown tool. */
    readonly setPolicy: (userId: string, tool: string, policy: Policy) => Effect.Effect<boolean>;
    /**
     * Runs a tool as one of the user's accounts, subject to the user's policy. `account` selects
     * by ID or display name and may be omitted when only one account of the provider is connected.
     */
    readonly call: (options: {
      readonly userId: string;
      readonly tool: Tool;
      readonly account: string | undefined;
      readonly arguments: unknown;
      readonly caller: string | null;
    }) => Effect.Effect<Outcome>;
    readonly approvals: (userId: string) => Effect.Effect<ReadonlyArray<Approval>>;
    readonly approval: (userId: string, id: string) => Effect.Effect<Approval | undefined>;
    /** Approving runs the call with its stored arguments. `undefined` when it can't be decided. */
    readonly decide: (
      userId: string,
      id: string,
      decision: "approve" | "deny",
    ) => Effect.Effect<Approval | undefined>;
    /** Waits up to `timeoutMs` for an approval to be decided and, when approved, to finish. */
    readonly await: (
      userId: string,
      id: string,
      timeoutMs: number,
    ) => Effect.Effect<Approval | undefined>;
  }
>()("macrograph/cloudflare/Gateway") {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    const database = yield* Database.Service;
    const providers = yield* OAuthProviders.Service;
    const httpClient = yield* HttpClient.HttpClient;
    const allowedUsers = new Set(
      (yield* Config.String("GATEWAY_ALLOWED_USERS").pipe(Config.withDefault(""), Effect.orDie))
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== ""),
    );

    const credentialRows = (userId: string) =>
      CredentialStore.rowsFor(database, userId).pipe(
        Effect.map((rows) => rows.filter((row) => Catalog.provider(row.providerId) !== undefined)),
      );

    const toAccount = (row: CredentialRow): Account => ({
      provider: row.providerId,
      id: row.providerUserId,
      displayName: row.displayName,
    });

    const policies = (userId: string) =>
      database
        .select({ tool: gatewayToolPolicies.tool, policy: gatewayToolPolicies.policy })
        .from(gatewayToolPolicies)
        .where(eq(gatewayToolPolicies.userId, userId))
        .pipe(
          Effect.orDie,
          Effect.map((rows) => new Map(rows.map((row) => [row.tool, row.policy]))),
        );

    const policyFor = (userId: string, tool: Tool) =>
      database
        .select({ policy: gatewayToolPolicies.policy })
        .from(gatewayToolPolicies)
        .where(and(eq(gatewayToolPolicies.userId, userId), eq(gatewayToolPolicies.tool, tool.name)))
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows[0]?.policy ?? defaultPolicy(tool)),
        );

    /** Sends the request, refreshing the account's token once if the provider rejects it. */
    const run = (userId: string, tool: Tool, accountId: string, inputs: Inputs) =>
      Effect.gen(function* () {
        const provider = Catalog.provider(tool.provider);
        if (provider === undefined) return { error: `Unknown provider ${tool.provider}` };
        const rows = yield* credentialRows(userId);
        const row = rows.find(
          (row) => row.providerId === tool.provider && row.providerUserId === accountId,
        );
        if (row === undefined)
          return { error: `The ${provider.displayName} account is no longer connected` };
        const prepared = yield* tool.prepare(inputs, toAccount(row));
        const clientId = providers.get(provider.id)?.clientId;
        const send = (accessToken: string) =>
          Execute.execute(provider, prepared, { accessToken, clientId }).pipe(
            Effect.provideService(HttpClient.HttpClient, httpClient),
          );
        let response = yield* send(row.token.access_token);
        if (response.status === 401) {
          const refreshed = yield* CredentialStore.refresh(
            database,
            providers,
            userId,
            provider.id,
            accountId,
          );
          if (refreshed !== undefined && refreshed.token.access_token !== row.token.access_token)
            response = yield* send(refreshed.token.access_token);
        }
        return { response };
      }).pipe(
        Effect.catchTags({
          GatewayInvalidInput: (error) => Effect.succeed({ error: error.message }),
          GatewayRequestError: (error) => Effect.succeed({ error: error.message }),
        }),
      );

    const toApproval = (row: ApprovalRow, accounts: ReadonlyArray<Account>): Approval => ({
      id: row.id,
      tool: row.tool,
      title: Catalog.tool(row.tool)?.title ?? row.tool,
      provider: row.provider,
      account: {
        id: row.accountId,
        displayName:
          accounts.find(
            (account) => account.provider === row.provider && account.id === row.accountId,
          )?.displayName ?? null,
      },
      arguments: isInputs(row.arguments) ? row.arguments : {},
      caller: row.caller,
      status: row.status,
      result:
        row.result === null
          ? null
          : {
              status: row.result.status,
              body: Schema.is(Schema.Json)(row.result.body) ? row.result.body : null,
            },
      error: row.error,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      decidedAt: row.decidedAt,
      completedAt: row.completedAt,
    });

    const expireLapsed = (userId: string) =>
      database
        .update(gatewayApprovals)
        .set({ status: "expired" })
        .where(
          and(
            eq(gatewayApprovals.userId, userId),
            eq(gatewayApprovals.status, "pending"),
            lte(gatewayApprovals.expiresAt, new Date().toISOString()),
          ),
        )
        .pipe(Effect.orDie, Effect.asVoid);

    const approval = (userId: string, id: string) =>
      Effect.gen(function* () {
        yield* expireLapsed(userId);
        const rows = yield* database
          .select()
          .from(gatewayApprovals)
          .where(and(eq(gatewayApprovals.userId, userId), eq(gatewayApprovals.id, id)))
          .limit(1)
          .pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return undefined;
        return toApproval(row, (yield* credentialRows(userId)).map(toAccount));
      });

    const settled = (status: GatewayApprovalStatus) => status !== "pending" && status !== "running";

    const awaitApproval = (userId: string, id: string, timeoutMs: number) =>
      Effect.gen(function* () {
        const deadline = Date.now() + timeoutMs;
        while (true) {
          const current = yield* approval(userId, id);
          if (current === undefined || settled(current.status) || Date.now() >= deadline)
            return current;
          yield* Effect.sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
        }
      });

    return {
      allows: (userId) => allowedUsers.has(userId),

      accounts: (userId) => credentialRows(userId).pipe(Effect.map((rows) => rows.map(toAccount))),

      tools: (userId) =>
        policies(userId).pipe(
          Effect.map((chosen) =>
            Catalog.tools.map((tool) => ({
              tool,
              policy: chosen.get(tool.name) ?? defaultPolicy(tool),
              defaultPolicy: defaultPolicy(tool),
            })),
          ),
        ),

      setPolicy: (userId, name, policy) =>
        Effect.gen(function* () {
          const tool = Catalog.tool(name);
          if (tool === undefined) return false;
          if (policy === defaultPolicy(tool))
            yield* database
              .delete(gatewayToolPolicies)
              .where(
                and(eq(gatewayToolPolicies.userId, userId), eq(gatewayToolPolicies.tool, name)),
              )
              .pipe(Effect.orDie);
          else {
            const updatedAt = new Date().toISOString();
            yield* database
              .insert(gatewayToolPolicies)
              .values({ userId, tool: name, policy, updatedAt })
              .onConflictDoUpdate({
                target: [gatewayToolPolicies.userId, gatewayToolPolicies.tool],
                set: { policy, updatedAt },
              })
              .pipe(Effect.orDie);
          }
          return true;
        }),

      call: ({ userId, tool, account, arguments: args, caller }) =>
        Effect.gen(function* () {
          const policy = yield* policyFor(userId, tool);
          if (!isInputs(args)) return failed("Arguments must be a JSON object");
          const provider = Catalog.provider(tool.provider);
          const accounts = (yield* credentialRows(userId))
            .filter((row) => row.providerId === tool.provider)
            .map(toAccount);
          const name = provider?.displayName ?? tool.provider;
          const describe = (account: Account) =>
            account.displayName === null ? account.id : `${account.displayName} (${account.id})`;
          const selected =
            account === undefined
              ? accounts.length === 1
                ? accounts[0]
                : undefined
              : accounts.find(
                  (candidate) =>
                    candidate.id === account ||
                    candidate.displayName?.toLowerCase() === account.toLowerCase(),
                );
          if (selected === undefined)
            return failed(
              accounts.length === 0
                ? `No ${name} account is connected. Connect one on the MacroGraph website.`
                : account === undefined
                  ? `Several ${name} accounts are connected; pass account as one of: ${accounts.map(describe).join(", ")}`
                  : `No connected ${name} account matches "${account}". Connected: ${accounts.map(describe).join(", ")}`,
            );
          // Invalid calls fail now rather than after the user approves them.
          const invalid = yield* tool.prepare(args, selected).pipe(
            Effect.as(undefined),
            Effect.catchTag("GatewayInvalidInput", (error) => Effect.succeed(error.message)),
          );
          if (invalid !== undefined) return failed(invalid);
          if (policy === "allow") return toOutcome(yield* run(userId, tool, selected.id, args));

          const now = new Date();
          const id = crypto.randomUUID();
          yield* database
            .insert(gatewayApprovals)
            .values({
              id,
              userId,
              tool: tool.name,
              provider: tool.provider,
              accountId: selected.id,
              arguments: args,
              caller,
              status: "pending",
              createdAt: now.toISOString(),
              expiresAt: new Date(now.getTime() + approvalLifetimeMs).toISOString(),
            })
            .pipe(Effect.orDie);
          const created = yield* approval(userId, id);
          if (created === undefined) return failed("The approval request could not be created");
          return { _tag: "Approval", approval: created } satisfies Outcome;
        }),

      approvals: (userId) =>
        Effect.gen(function* () {
          yield* expireLapsed(userId);
          const rows = yield* database
            .select()
            .from(gatewayApprovals)
            .where(eq(gatewayApprovals.userId, userId))
            .orderBy(desc(gatewayApprovals.createdAt))
            .limit(50)
            .pipe(Effect.orDie);
          const accounts = (yield* credentialRows(userId)).map(toAccount);
          return rows.map((row) => toApproval(row, accounts));
        }),

      approval,

      decide: (userId, id, decision) =>
        Effect.gen(function* () {
          const decidedAt = new Date().toISOString();
          const claimed = yield* database
            .update(gatewayApprovals)
            .set({ status: decision === "approve" ? "running" : "denied", decidedAt })
            .where(
              and(
                eq(gatewayApprovals.userId, userId),
                eq(gatewayApprovals.id, id),
                eq(gatewayApprovals.status, "pending"),
                gt(gatewayApprovals.expiresAt, decidedAt),
              ),
            )
            .returning()
            .pipe(Effect.orDie);
          const row = claimed[0];
          if (row === undefined) return undefined;
          if (decision === "approve") {
            const tool = Catalog.tool(row.tool);
            const result =
              tool === undefined
                ? { error: `Unknown tool ${row.tool}` }
                : !isInputs(row.arguments)
                  ? { error: "Stored arguments are invalid" }
                  : yield* run(userId, tool, row.accountId, row.arguments);
            yield* database
              .update(gatewayApprovals)
              .set(
                "error" in result
                  ? { status: "failed", error: result.error, completedAt: new Date().toISOString() }
                  : {
                      status: "succeeded",
                      result: result.response,
                      completedAt: new Date().toISOString(),
                    },
              )
              .where(and(eq(gatewayApprovals.id, id), eq(gatewayApprovals.status, "running")))
              .pipe(Effect.orDie);
          }
          return yield* approval(userId, id);
        }),

      await: awaitApproval,
    };
  }),
);

export * as Gateway from "./Gateway.ts";
