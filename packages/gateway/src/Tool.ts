import { Data, type Effect, Schema } from "effect";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface PropertySchema {
  readonly type: "string" | "integer" | "boolean";
  readonly description?: string;
  readonly enum?: ReadonlyArray<string | number>;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly default?: string | number | boolean;
}

export interface InputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, PropertySchema>>;
  readonly required: ReadonlyArray<string>;
  readonly additionalProperties: false;
}

/** The connected account a call runs as. */
export interface Account {
  readonly id: string;
  readonly displayName: string | null;
}

export type Inputs = Readonly<Record<string, Schema.Json>>;

/** A provider request with the account's authorization still to be added. */
export interface PreparedRequest {
  readonly method: Method;
  /** A path on the provider's API, or an absolute URL on one of its `origins`. */
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number>>;
  readonly body?: Schema.Json;
}

export class InvalidInput extends Data.TaggedError("GatewayInvalidInput")<{
  readonly message: string;
}> {}

/** One provider operation an agent can call through the gateway. */
export interface Tool {
  /** Unique, MCP-safe name such as `twitch_ban_user`. */
  readonly name: string;
  readonly provider: string;
  readonly title: string;
  readonly description: string;
  readonly method: Method;
  /** Whether the operation only reads; writes require approval by default. */
  readonly readOnly: boolean;
  /** OAuth scopes, any one of which grants the operation. */
  readonly scopes: ReadonlyArray<string>;
  readonly inputSchema: InputSchema;
  readonly prepare: (
    inputs: Inputs,
    account: Account,
  ) => Effect.Effect<PreparedRequest, InvalidInput>;
}

export const Policy = Schema.Literals(["allow", "approve"]);
export type Policy = typeof Policy.Type;

/** Reads run without asking; anything that changes data waits for the user's approval. */
export const defaultPolicy = (tool: Pick<Tool, "readOnly">): Policy =>
  tool.readOnly ? "allow" : "approve";

/** `WarnUser` → `warn_user`, `GetUserChatColorByID` → `get_user_chat_color_by_id`. */
export const snakeCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();
