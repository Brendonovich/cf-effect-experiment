import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { Service as RuntimeService } from "./Runtime.ts";

import ProjectEditor from "../editor/ProjectEditor.ts";

const responseFor = (response: {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
}) =>
  response.body === undefined
    ? HttpServerResponse.empty({ status: response.status })
    : HttpServerResponse.text(response.body, {
        status: response.status,
        ...(response.contentType === undefined ? {} : { contentType: response.contentType }),
      });

export const make = (runtime: RuntimeService) =>
  Effect.gen(function* () {
    const projectEditors = yield* ProjectEditor;
    return HttpRouter.add(
      "POST",
      "/runtime/ingress/:projectId/:endpointId",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const route = yield* HttpRouter.RouteContext;
        const projectId = route.params.projectId;
        const endpointId = route.params.endpointId;
        if (projectId === undefined || endpointId === undefined)
          return HttpServerResponse.empty({ status: 400 });
        const body = yield* request.arrayBuffer.pipe(Effect.orDie);
        const response = yield* runtime.handleIngress({
          projectId,
          endpointId,
          method: request.method,
          headers: Object.entries(request.headers).flatMap(([name, value]) =>
            typeof value === "string" ? [[name, value] as const] : [],
          ),
          body: new Uint8Array(body),
        });
        const editor = projectEditors.getByName(projectId);
        yield* Effect.forEach(response.previewEvents, (event) => editor.previewEvent(event), {
          discard: true,
        });
        return responseFor(response);
      }),
    );
  });
