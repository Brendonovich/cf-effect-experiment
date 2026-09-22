import { Schema } from "effect";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

export const Started = Schema.Struct({ id: Schema.String });
export const Status = Schema.Struct({
  status: Schema.String,
  error: Schema.optional(Schema.Unknown),
  output: Schema.optional(
    Schema.NullOr(Schema.Struct({ executionId: Schema.String, projectId: Schema.String })),
  ),
});

export async function verify(url: string, headers: Record<string, string> = {}) {
  const evidence: unknown[] = [];
  let passed = false;
  const request = async (path: string, init?: RequestInit) => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(new URL(path, url), {
        ...init,
        headers: { ...headers, ...init?.headers },
        signal: AbortSignal.timeout(30_000),
      });
      // Read-only status requests can transiently fail while the platform's
      // workflow bindings propagate. POST is retried only for the edge's HTML
      // 404 (the request never reached the worker), not an ambiguous failure.
      if (
        attempt < 30 &&
        ((response.status === 404 && response.headers.get("content-type")?.includes("text/html")) ||
          (init?.method !== "POST" && response.status >= 500))
      ) {
        evidence.push({
          path,
          retryStatus: response.status,
          body: (await response.text()).slice(0, 2_000),
        });
        await setTimeout(2_000);
        continue;
      }
      assert.equal(
        response.status,
        200,
        `${path}: ${(await response.clone().text()).slice(0, 600)}`,
      );
      const body: unknown = await response.json();
      evidence.push({ path, httpStatus: response.status, body });
      return body;
    }
  };
  try {
    assert.deepEqual(await request("/health"), { ok: true });
    for (const value of ["durable", "fail"]) {
      const executionId = crypto.randomUUID();
      const started = Schema.decodeUnknownSync(Started)(
        await request("/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ executionId, value }),
        }),
      );
      assert.equal(typeof started.id, "string");
      let terminal = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        const status = Schema.decodeUnknownSync(Status)(await request(`/runs/${started.id}`));
        evidence.push({ executionId, value, ...status });
        if (status.status === "complete" || status.status === "errored") {
          assert.equal(status.status, value === "durable" ? "complete" : "errored");
          if (value === "durable") {
            assert.ok(status.output);
            assert.equal(status.output.executionId, executionId);
            assert.equal(status.output.projectId, "infra-project");
            // Re-reading a completed run must retain its result.
            assert.deepEqual(
              Schema.decodeUnknownSync(Status)(await request(`/runs/${started.id}`)),
              status,
            );
          }
          terminal = true;
          break;
        }
        await setTimeout(1_000);
      }
      assert.ok(terminal, `Workflow ${started.id} did not reach a terminal status`);
    }
    passed = true;
  } finally {
    await mkdir(".alchemy/evidence", { recursive: true });
    await writeFile(
      ".alchemy/evidence/runs.json",
      JSON.stringify({ status: passed ? "passed" : "failed", url, evidence }, null, 2),
    );
  }
}
