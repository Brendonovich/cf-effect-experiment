import * as Actions from "@macrograph/module-twitch/Actions";
import { DEFAULT_CLIENT_ID } from "@macrograph/module-twitch/Helix";
import { Effect } from "effect";

import type { Provider } from "../Provider.ts";

import { InvalidInput, type PropertySchema, snakeCase, type Tool } from "../Tool.ts";

export const provider: Provider = {
  id: "twitch",
  displayName: "Twitch",
  baseUrl: "https://api.twitch.tv/helix",
  origins: ["https://id.twitch.tv"],
  headers: ({ accessToken, clientId }) => ({
    authorization: `Bearer ${accessToken}`,
    "client-id": clientId ?? DEFAULT_CLIENT_ID,
  }),
};

type Action = (typeof Actions.actions)[number];

const rewardFieldsDescription =
  "JSON object string of reward fields: prompt, background_color (#RRGGBB), is_enabled, is_user_input_required, is_max_per_stream_enabled, max_per_stream, is_max_per_user_per_stream_enabled, max_per_user_per_stream, is_global_cooldown_enabled, global_cooldown_seconds, is_paused, should_redemptions_skip_request_queue";

const describe = (input: Actions.Input) => {
  if (input.id === "broadcasterId")
    return "Channel's Twitch user ID. Defaults to the connected account.";
  if (input.id === "optionsJson" || input.id === "changesJson")
    return input.id === "changesJson"
      ? `${rewardFieldsDescription}, title, cost.`
      : `${rewardFieldsDescription}.`;
  const label = input.name !== undefined && input.name !== "" ? input.name : input.id;
  return input.key === undefined ? label : `${label} (Twitch \`${input.key}\`)`;
};

const property = (input: Actions.Input): PropertySchema => {
  const kind = input.kind ?? "string";
  const type = kind === "int" ? "integer" : kind === "bool" ? "boolean" : "string";
  const bounds =
    type === "integer"
      ? {
          ...(input.min === undefined ? {} : { minimum: input.min }),
          ...(input.max === undefined ? {} : { maximum: input.max }),
        }
      : type === "string"
        ? {
            ...(input.min === undefined ? {} : { minLength: input.min }),
            ...(input.max === undefined ? {} : { maxLength: input.max }),
          }
        : {};
  return {
    type,
    description: describe(input),
    ...bounds,
    ...(input.values === undefined ? {} : { enum: input.values }),
  };
};

const roleNote: Record<NonNullable<Action["role"]>, string> = {
  broadcaster: " The channel must be the connected account's own.",
  moderator: " The connected account must moderate the channel.",
  sender: " Sent as the connected account.",
};

const toTool = (action: Action): Tool => {
  const defaultsToAccount = action.inputs.some((input) => input.id === "broadcasterId");
  const scopes =
    action.scopes.length === 0 ? "" : ` Requires one of the scopes: ${action.scopes.join(", ")}.`;
  return {
    name: `twitch_${snakeCase(action.id)}`,
    provider: provider.id,
    title: action.name,
    description: `${action.name} on Twitch (${action.method} ${action.path}).${action.role === undefined ? "" : roleNote[action.role]}${scopes}`,
    method: action.method,
    readOnly: action.method === "GET",
    scopes: action.scopes,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(action.inputs.map((input) => [input.id, property(input)])),
      required: action.inputs
        .filter((input) => !input.optional && input.id !== "broadcasterId")
        .map((input) => input.id),
      additionalProperties: false,
    },
    prepare: (inputs, account) =>
      Actions.prepare(
        action.id,
        defaultsToAccount && inputs.broadcasterId === undefined
          ? { ...inputs, broadcasterId: account.id }
          : inputs,
        account.id,
      ).pipe(
        Effect.map((prepared) => ({
          method: action.method,
          path: action.path,
          query: prepared.query,
          ...(prepared.body === undefined ? {} : { body: prepared.body }),
        })),
        Effect.mapError((error) => new InvalidInput({ message: error.reason })),
      ),
  };
};

export const tools: ReadonlyArray<Tool> = Actions.actions.map(toTool);
