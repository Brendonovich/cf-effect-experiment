import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import type { Service as CloudWorkerOperationsService } from "../worker/CloudWorkerOperations.ts";

import { IngressApi } from "./IngressApi.ts";

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

export const make = (workerOperations: CloudWorkerOperationsService) =>
  HttpApiBuilder.group(IngressApi, "ingress", (handlers) =>
    handlers.handleRaw(
      "handle",
      Effect.fnUntraced(function* ({ params, request }) {
        const body = yield* request.arrayBuffer.pipe(Effect.orDie);
        const response = yield* workerOperations
          .handleIngress({
            projectId: params.projectId,
            endpointId: params.endpointId,
            method: request.method,
            headers: Object.entries(request.headers).flatMap(([name, value]) =>
              typeof value === "string" ? [[name, value] as const] : [],
            ),
            body: new Uint8Array(body),
          })
          .pipe(Effect.orDie);
        return responseFor(response);
      }),
    ),
  );
