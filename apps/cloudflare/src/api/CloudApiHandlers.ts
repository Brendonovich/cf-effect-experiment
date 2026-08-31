import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import * as Authentication from "../auth/Authentication.ts";
import * as Credential from "../auth/Credential.ts";
import * as Deployment from "../deployment/Deployment.ts";
import * as EditorRpc from "../editor/EditorRpc.ts";
import * as Event from "../execution/Event.ts";
import * as Project from "../project/Project.ts";
import * as Team from "../team/Team.ts";
import { Api } from "./Api.ts";

export const sessionHandlers = HttpApiBuilder.group(
  Api,
  "session",
  Effect.fnUntraced(function* (handlers) {
    const authentication = yield* Authentication.Service;
    return handlers
      .handle("get", ({ request }) => authentication.sessionStatus(request))
      .handle("start", ({ request }) => authentication.startSession(request))
      .handle("startWebsite", ({ request }) => authentication.startWebsiteSession(request))
      .handle("pollWebsite", ({ payload, request }) =>
        authentication.pollWebsiteSession(payload.registrationId, request),
      )
      .handle("poll", ({ request }) => authentication.pollSession(request))
      .handle("disconnect", ({ request }) => authentication.disconnectSession(request))
      .handle("issueApiKey", ({ payload, request }) =>
        authentication.issueApiKey(payload.name, request),
      )
      .handle("revokeApiKey", ({ params, request }) =>
        authentication.revokeApiKey(params.apiKeyId, request),
      );
  }),
);

export const teamHandlers = HttpApiBuilder.group(
  Api,
  "teams",
  Effect.fnUntraced(function* (handlers) {
    const team = yield* Team.Service;
    return handlers
      .handle("list", () => team.list())
      .handle("create", ({ payload }) => team.create(payload.name))
      .handle("listMembers", ({ params }) => team.listMembers(params.teamId))
      .handle("addMember", ({ params, payload }) =>
        team.addMember(params.teamId, payload.email, payload.role),
      )
      .handle("setMember", ({ params, payload }) =>
        team.setMember(params.teamId, params.userId, payload.role),
      )
      .handle("removeMember", ({ params }) => team.removeMember(params.teamId, params.userId));
  }),
);

export const projectHandlers = HttpApiBuilder.group(
  Api,
  "projects",
  Effect.fnUntraced(function* (handlers) {
    const project = yield* Project.Service;
    return handlers
      .handle("list", () => project.list())
      .handle("create", ({ payload }) => project.create(payload))
      .handle("get", ({ params }) => project.get(params))
      .handle("listGraphs", ({ params }) => project.listGraphs(params))
      .handle("createGraph", ({ params, payload }) =>
        project.createGraph({ ...params, ...payload }),
      )
      .handle("getGraph", ({ params }) => project.getGraph(params))
      .handle("deleteGraph", ({ params, query }) =>
        project.deleteGraph({ ...params, force: query.force === "true" }).pipe(Effect.asVoid),
      )
      .handle("listSchemas", ({ params, query }) =>
        project.searchSchemas({ ...params, query: query.query, limit: query.limit }),
      )
      .handle("listResources", ({ params }) => project.listResources(params))
      .handle("createNode", ({ params, payload }) => project.createNode({ ...params, ...payload }))
      .handle("createConnection", ({ params, payload }) =>
        project.createConnection({ ...params, ...payload }),
      )
      .handle("remove", ({ params }) => project.remove(params.projectId))
      .handle("getAccess", ({ params }) => project.getAccess(params.projectId))
      .handle("setAccess", ({ params, payload }) =>
        project.setAccess(params.projectId, payload.access, payload.userIds),
      );
  }),
);

export const deploymentHandlers = HttpApiBuilder.group(
  Api,
  "deployments",
  Effect.fnUntraced(function* (handlers) {
    const deployment = yield* Deployment.Service;
    return handlers
      .handle("list", ({ params }) => deployment.list(params.projectId))
      .handle("get", ({ params }) => deployment.get(params.projectId, params.deploymentId))
      .handle("deploy", ({ params, request }) =>
        deployment.deploy(params.projectId, deployment.publicOrigin(request)),
      );
  }),
);

export const eventHandlers = HttpApiBuilder.group(
  Api,
  "events",
  Effect.fnUntraced(function* (handlers) {
    const event = yield* Event.Service;
    return handlers
      .handle("list", ({ params }) => event.list(params.projectId))
      .handle("replay", ({ params, payload }) =>
        event.replay(params.projectId, params.eventId, payload.kind),
      );
  }),
);

export const executionHandlers = HttpApiBuilder.group(
  Api,
  "executions",
  Effect.fnUntraced(function* (handlers) {
    const event = yield* Event.Service;
    return handlers
      .handle("list", ({ params, query }) =>
        event.listExecutions(params.projectId, query.deploymentId),
      )
      .handle("get", ({ params }) => event.getExecution(params.projectId, params.executionId));
  }),
);

export const previewHandlers = HttpApiBuilder.group(
  Api,
  "previews",
  Effect.fnUntraced(function* (handlers) {
    const deployment = yield* Deployment.Service;
    return handlers
      .handle("start", ({ params, payload, request }) =>
        deployment.startPreview(
          params.projectId,
          payload.previewId,
          deployment.publicOrigin(request),
        ),
      )
      .handle("stop", ({ params, payload }) =>
        deployment.stopPreview(params.projectId, payload.previewId),
      );
  }),
);

export const credentialHandlers = HttpApiBuilder.group(
  Api,
  "credentials",
  Effect.fnUntraced(function* (handlers) {
    const credential = yield* Credential.Service;
    return handlers
      .handle("list", ({ params }) => credential.list(params.projectId))
      .handle("refetch", ({ params }) => credential.refetch(params.projectId));
  }),
);

export const editorRpcHandlers = HttpApiBuilder.group(
  Api,
  "editorRpc",
  Effect.fnUntraced(function* (handlers) {
    const editorRpc = yield* EditorRpc.Service;
    return handlers
      .handleRaw("connect", ({ request }) => editorRpc.handle(request))
      .handleRaw("request", ({ request }) => editorRpc.handle(request));
  }),
);

export const layer = Layer.mergeAll(
  sessionHandlers,
  teamHandlers,
  projectHandlers,
  deploymentHandlers,
  executionHandlers,
  eventHandlers,
  previewHandlers,
  credentialHandlers,
  editorRpcHandlers,
);
