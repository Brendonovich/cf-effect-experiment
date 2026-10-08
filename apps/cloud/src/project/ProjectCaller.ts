import type { EditorAccess } from "@macrograph/editor";

import { CurrentUser } from "@macrograph/cloud-api";
import { ApiCaller } from "@macrograph/project-api";
import { Effect } from "effect";

/**
 * The calling REST or MCP client, as shown in the project editor's presence and attributed on its
 * edits. It is passed to the project's Durable Object, so it must stay structured-cloneable.
 */
export const identity = (
  projectId: string,
  canEdit: boolean,
): Effect.Effect<EditorAccess.ConnectionIdentity, never, CurrentUser> =>
  Effect.gen(function* () {
    const user = yield* CurrentUser;
    const caller = yield* ApiCaller.Current;
    return ApiCaller.identityFor(caller, {
      userId: user.id,
      projectId,
      canEdit,
      canManageCredentials: false,
    });
  });

export * as ProjectCaller from "./ProjectCaller.ts";
