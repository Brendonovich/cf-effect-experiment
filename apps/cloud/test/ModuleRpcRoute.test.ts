import { assert, describe, it } from "@effect/vitest";
import { ProjectNotFound, sessionCookieName } from "@macrograph/cloud-api";
import { Project } from "@macrograph/core";
import { Editor, EditorEvents, Packages } from "@macrograph/editor";
import { DiscordEngine } from "@macrograph/module-discord/Definition";
import { ModuleRegistry } from "@macrograph/module-host/core";
import { OpenAIEngine } from "@macrograph/module-openai/Definition";
import { Persistence } from "@macrograph/persistence";
import { Context, Effect, Layer } from "effect";
import { HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EditorRpc from "../src/editor/EditorRpc.ts";
import * as CloudModules from "../src/modules/CloudModules.ts";
import { identity, moduleClient, routeClient, testEditorHost } from "./moduleRpc.ts";

const member = {
  project: { id: "project-1", name: "Project", createdBy: "user-1" },
  role: "viewer" as const,
  email: "ada@example.com",
};

const request = (path: string, headers: Record<string, string> = {}) =>
  HttpServerRequest.fromWeb(
    new Request(`https://cloud.macrograph.app${path}`, {
      method: "POST",
      headers: { cookie: `${sessionCookieName}=session-1`, ...headers },
      body: "{}",
    }),
  );

const modulePath = "/rpc/projects/project-1/module/macrograph.app/macrograph/openai/rpc";
const params = {
  projectId: "project-1",
  namespace: "macrograph.app",
  publisher: "macrograph",
  name: "openai",
};

const makeWorker = (options: {
  readonly allowed?: boolean;
  readonly member?: EditorRpc.ProjectMember | undefined;
}) => {
  const forwarded: Array<{ readonly project: string; readonly request: Request }> = [];
  const handlers = EditorRpc.makeHandlers({
    sessionUser: (sessionId) => Effect.succeed(sessionId === "session-1" ? "user-1" : undefined),
    member: () => Effect.succeed("member" in options ? options.member : member),
    canView: () => (options.allowed === false ? Effect.fail(new ProjectNotFound()) : Effect.void),
    publicOrigin: () => "https://cloud.macrograph.app",
    editor: (project) => ({
      fetch: (forward) =>
        Effect.sync(() => {
          if (forward.source instanceof Request)
            forwarded.push({ project, request: forward.source });
          return HttpServerResponse.text("forwarded");
        }),
    }),
  });
  return { handlers, forwarded };
};

describe("module RPC route", () => {
  it.effect("authorizes by project access before forwarding to the project's editor", () =>
    Effect.gen(function* () {
      const unauthenticated = makeWorker({});
      const anonymous = yield* unauthenticated.handlers.handleModuleRpc(
        HttpServerRequest.fromWeb(
          new Request(`https://cloud.macrograph.app${modulePath}`, { method: "POST" }),
        ),
        params,
      );
      assert.strictEqual(anonymous.status, 401);

      const denied = makeWorker({ allowed: false });
      assert.strictEqual(
        (yield* denied.handlers.handleModuleRpc(request(modulePath), params)).status,
        404,
      );
      assert.strictEqual(denied.forwarded.length, 0);

      const outsider = makeWorker({ member: undefined });
      assert.strictEqual(
        (yield* outsider.handlers.handleModuleRpc(request(modulePath), params)).status,
        404,
      );
      assert.strictEqual(outsider.forwarded.length, 0);

      const invalid = makeWorker({});
      assert.strictEqual(
        (yield* invalid.handlers.handleModuleRpc(request(modulePath), {
          ...params,
          name: "Not Valid",
        })).status,
        404,
      );
      assert.strictEqual(invalid.forwarded.length, 0);

      const crossOrigin = makeWorker({});
      assert.strictEqual(
        (yield* crossOrigin.handlers.handleModuleRpc(
          request(modulePath, { origin: "https://evil.example" }),
          params,
        )).status,
        403,
      );
    }),
  );

  it.effect("forwards to the module's path in the project's editor with trusted identity", () =>
    Effect.gen(function* () {
      const worker = makeWorker({});
      const response = yield* worker.handlers.handleModuleRpc(
        request(modulePath, { "x-macrograph-role": "owner", "x-macrograph-user-id": "intruder" }),
        params,
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual(worker.forwarded.length, 1);
      const forwarded = worker.forwarded[0]!;
      assert.strictEqual(forwarded.project, "project-1");
      const url = new URL(forwarded.request.url);
      assert.strictEqual(url.pathname, "/module/macrograph.app/macrograph/openai/rpc");
      assert.strictEqual(url.searchParams.get("projectId"), "project-1");
      assert.strictEqual(forwarded.request.method, "POST");
      assert.strictEqual(yield* Effect.promise(() => forwarded.request.text()), "{}");
      // Identity comes from the database, never from the client.
      assert.strictEqual(forwarded.request.headers.get("x-macrograph-role"), "viewer");
      assert.strictEqual(forwarded.request.headers.get("x-macrograph-user-id"), "user-1");
      assert.strictEqual(forwarded.request.headers.get("x-macrograph-project-id"), "project-1");
    }),
  );

  it.effect("serves each module's RPCs from its own handler and needs edit access", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        yield* persistence.saveProject(Project.empty());
        const context = yield* Layer.build(CloudModules.registryLayer(testEditorHost));
        const registry = Context.get(context, ModuleRegistry.Service);
        const scope = yield* Effect.scope;
        const via = (headers: Record<string, string>) =>
          routeClient(registry, { projectId: "project-1", headers, scope });

        const openai = yield* moduleClient(
          OpenAIEngine.ClientRpcs,
          CloudModules.ids.openai,
          via(identity("member")),
        );
        yield* openai.OpenAIUpdateKey({ apiKey: "openai-secret" });
        const discord = yield* moduleClient(
          DiscordEngine.ClientRpcs,
          CloudModules.ids.discord,
          via(identity("owner")),
        );
        yield* discord.DiscordConfigure({
          token: "discord-secret",
          gatewayEnabled: false,
          messageContent: false,
        });
        const project = yield* persistence.loadProject();
        assert.deepStrictEqual(project.engines[CloudModules.ids.openai], {
          apiKey: "openai-secret",
        });
        assert.strictEqual(
          (project.engines[CloudModules.ids.discord] as { readonly token: string }).token,
          "discord-secret",
        );

        // An OpenAI request sent to Discord's route reaches Discord's handler, which rejects it.
        const misrouted = yield* moduleClient(
          OpenAIEngine.ClientRpcs,
          CloudModules.ids.discord,
          via(identity("owner")),
        );
        const misroutedExit = yield* Effect.exit(misrouted.OpenAIUpdateKey({ apiKey: "nope" }));
        assert.strictEqual(misroutedExit._tag, "Failure");
        assert.deepStrictEqual(
          (yield* persistence.loadProject()).engines[CloudModules.ids.openai],
          { apiKey: "openai-secret" },
        );

        const post = (moduleId: string, headers: Record<string, string>) =>
          via(headers).execute(
            HttpClientRequest.post(`http://project-editor.local/module/${moduleId}/rpc`),
          );
        assert.strictEqual((yield* post(CloudModules.ids.openai, identity("viewer"))).status, 403);
        assert.strictEqual(
          (yield* post(CloudModules.ids.openai, identity("owner", "project-2"))).status,
          401,
        );
        assert.strictEqual(
          (yield* post("macrograph.app/macrograph/unknown", identity("owner"))).status,
          404,
        );
        // Modules without an engine have no RPCs.
        assert.strictEqual((yield* post(CloudModules.ids.json, identity("owner"))).status, 404);

        yield* registry.unload(CloudModules.ids.openai);
        assert.strictEqual((yield* post(CloudModules.ids.openai, identity("owner"))).status, 503);
      }).pipe(
        Effect.provide(
          Editor.layer.pipe(
            Layer.provideMerge(EditorEvents.layer),
            Layer.provideMerge(Packages.defaultLayer),
          ),
        ),
        Effect.provide(
          Layer.succeed(HttpClient.HttpClient)(
            HttpClient.make(() => Effect.die("Module RPC tests must not call a provider")),
          ),
        ),
        Effect.provide(Persistence.layerMemory),
      ),
    ),
  );
});
