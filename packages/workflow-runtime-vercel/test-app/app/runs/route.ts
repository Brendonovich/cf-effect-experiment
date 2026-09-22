import { input, RunRequest } from "@macrograph/workflow-runtime-test/fixture";
import { Schema } from "effect";
import { start } from "workflow/api";

import { executeGraph } from "../../workflows/graph.ts";

export async function POST(request: Request) {
  const body = await request.json();
  if (!Schema.is(RunRequest)(body)) return new Response(null, { status: 400 });
  const run = await start(executeGraph, [input(body.executionId, body.value)]);
  return Response.json({ id: run.runId });
}
