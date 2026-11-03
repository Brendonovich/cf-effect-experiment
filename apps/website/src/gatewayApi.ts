import { createQuery } from "@tanstack/solid-query";

import { ApiError, apiFetch } from "./api";
import { useSession } from "./session";

/** MacroGraph Gateway's management API, served by Cloud for the signed-in website session. */
async function gatewayRequest<T>(
  path: string,
  init?: { readonly method?: string; readonly body?: unknown },
): Promise<T> {
  const response = await apiFetch(`/cloud/api/gateway/manage${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    throw new GatewayError(
      response.status,
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : undefined,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class GatewayError extends ApiError {
  constructor(
    status: number,
    readonly reason?: string,
  ) {
    super(status);
    if (reason !== undefined) this.message = reason;
  }
}

/** Paths on the website's origin. */
export const gatewayPaths = {
  mcp: "/cloud/api/gateway/mcp",
  api: "/cloud/api/gateway/v1",
  eventStream: "/cloud/api/gateway/manage/events/stream",
} as const;

export type GatewayPolicy = "allow" | "approve";

export interface GatewayTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly method: string;
  readonly readOnly: boolean;
  readonly policy: GatewayPolicy;
  readonly defaultPolicy: GatewayPolicy;
}

export interface GatewayAccount {
  readonly id: string;
  readonly displayName: string | null;
}

export interface GatewayProvider {
  readonly id: string;
  readonly displayName: string;
  readonly accounts: ReadonlyArray<GatewayAccount>;
  readonly tools: ReadonlyArray<GatewayTool>;
}

export type GatewayApprovalStatus =
  | "pending"
  | "denied"
  | "expired"
  | "running"
  | "succeeded"
  | "failed";

/** A call an agent made through the gateway that needed the user's approval. */
export interface GatewayApproval {
  readonly id: string;
  readonly tool: string;
  readonly title: string;
  readonly provider: string;
  readonly account: GatewayAccount;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly caller: string | null;
  readonly status: GatewayApprovalStatus;
  readonly result: { readonly status: number; readonly body: unknown } | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface GatewayKey {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface GatewayEvent {
  readonly seq: number;
  readonly id: string;
  readonly source: "twitch" | "github" | "discord";
  readonly account: string;
  readonly type: string;
  readonly receivedAt: string;
  readonly data: unknown;
}

export interface GithubRepository {
  readonly account: string;
  readonly installationId: string;
  readonly repositoryId: string;
  readonly owner: string;
  readonly repository: string;
}

export interface GithubSubscription extends GithubRepository {
  readonly events: ReadonlyArray<string>;
}

export interface DiscordIntent {
  readonly id: string;
  readonly name: string;
  readonly privileged: boolean;
}

export interface GatewaySubscriptions {
  readonly subscriptions: {
    readonly twitch: Readonly<Record<string, ReadonlyArray<string>>>;
    readonly github: ReadonlyArray<GithubSubscription>;
    readonly discord: {
      readonly bot: string | null;
      readonly intents: ReadonlyArray<string>;
    } | null;
  };
  readonly discord: {
    readonly status: "off" | "connecting" | "connected" | "error";
    readonly error: string | null;
  };
  readonly error: string | null;
  readonly options: {
    readonly twitch: {
      readonly accounts: ReadonlyArray<GatewayAccount>;
      readonly events: ReadonlyArray<string>;
    };
    readonly github: {
      readonly accounts: ReadonlyArray<GatewayAccount>;
      readonly events: ReadonlyArray<string>;
    };
    readonly discord: { readonly intents: ReadonlyArray<DiscordIntent> };
  };
}

export interface SubscriptionsInput {
  readonly twitch: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly github: ReadonlyArray<GithubSubscription>;
  /** A `null` token keeps the stored one. */
  readonly discord: {
    readonly token: string | null;
    readonly intents: ReadonlyArray<string>;
  } | null;
}

export interface GatewayWebhook {
  readonly id: string;
  readonly url: string;
  readonly events: ReadonlyArray<string>;
  readonly createdAt: string;
}

export interface GatewayDelivery {
  readonly id: string;
  readonly eventSeq: number;
  readonly attempts: number;
  readonly status: "pending" | "delivered" | "failed";
  readonly lastStatus: number | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export const gatewayKeys = {
  access: ["gateway", "access"] as const,
  tools: ["gateway", "tools"] as const,
  approvals: ["gateway", "approvals"] as const,
  keys: ["gateway", "keys"] as const,
  subscriptions: ["gateway", "subscriptions"] as const,
  repositories: ["gateway", "repositories"] as const,
  events: ["gateway", "events"] as const,
  webhooks: ["gateway", "webhooks"] as const,
  deliveries: (webhookId: string) => ["gateway", "deliveries", webhookId] as const,
};

export const gateway = {
  /** Treats an unreachable gateway as disabled, since every signed-in page checks this. */
  access: () =>
    gatewayRequest<{ readonly enabled: boolean }>("/access").catch(() => ({ enabled: false })),
  tools: () => gatewayRequest<{ readonly providers: ReadonlyArray<GatewayProvider> }>("/tools"),
  setPolicy: (input: { readonly tool: string; readonly policy: GatewayPolicy }) =>
    gatewayRequest<void>(`/tools/${encodeURIComponent(input.tool)}`, {
      method: "PUT",
      body: { policy: input.policy },
    }),
  approvals: () => gatewayRequest<ReadonlyArray<GatewayApproval>>("/approvals"),
  decide: (input: { readonly id: string; readonly decision: "approve" | "deny" }) =>
    gatewayRequest<GatewayApproval>(
      `/approvals/${encodeURIComponent(input.id)}/${input.decision}`,
      { method: "POST" },
    ),
  keys: () => gatewayRequest<{ readonly keys: ReadonlyArray<GatewayKey> }>("/keys"),
  createKey: (name: string) =>
    gatewayRequest<GatewayKey & { readonly key: string }>("/keys", {
      method: "POST",
      body: { name },
    }),
  revokeKey: (id: string) =>
    gatewayRequest<void>(`/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  subscriptions: () => gatewayRequest<GatewaySubscriptions>("/subscriptions"),
  setSubscriptions: (input: SubscriptionsInput) =>
    gatewayRequest<GatewaySubscriptions>("/subscriptions", { method: "PUT", body: input }),
  repositories: () =>
    gatewayRequest<{ readonly repositories: ReadonlyArray<GithubRepository> }>(
      "/github/repositories",
    ),
  events: () =>
    gatewayRequest<{ readonly events: ReadonlyArray<GatewayEvent> }>("/events?limit=50"),
  webhooks: () => gatewayRequest<{ readonly webhooks: ReadonlyArray<GatewayWebhook> }>("/webhooks"),
  addWebhook: (input: { readonly url: string; readonly events: ReadonlyArray<string> }) =>
    gatewayRequest<GatewayWebhook & { readonly secret: string }>("/webhooks", {
      method: "POST",
      body: input,
    }),
  removeWebhook: (id: string) =>
    gatewayRequest<void>(`/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deliveries: (webhookId: string) =>
    gatewayRequest<{ readonly deliveries: ReadonlyArray<GatewayDelivery> }>(
      `/webhooks/${encodeURIComponent(webhookId)}/deliveries`,
    ),
};

/** Whether MacroGraph Gateway is enabled for the signed-in account; it's limited to an allowlist. */
export const useGatewayAccess = () => {
  const session = useSession();
  return createQuery(() => ({
    queryKey: gatewayKeys.access,
    queryFn: gateway.access,
    enabled: session.data !== null && session.data !== undefined,
    staleTime: 5 * 60_000,
  }));
};
