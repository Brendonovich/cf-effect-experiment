import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { Effect, Schema } from "effect";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

interface VercelProject extends Resource<
  "WorkflowTest.VercelProject",
  {
    name: string;
  },
  { projectId: string; url: string }
> {}

export const VercelProject = Resource<VercelProject>("WorkflowTest.VercelProject");
const Project = Schema.Struct({ id: Schema.String });
const exec = promisify(execFile);

/** Alchemy v2 has no Vercel provider. This test-owned resource manages the
 * entire disposable project, including all deployments, through its lifecycle. */
export const providers = () =>
  Provider.succeed(VercelProject, {
    list: () => Effect.succeed([]),
    diff: () => Effect.succeed({ action: "update" }),
    precreate: ({ news }) =>
      Effect.tryPromise(async () => {
        const response = await api("/v11/projects", {
          method: "POST",
          body: JSON.stringify({
            name: news.name,
            framework: "nextjs",
            rootDirectory: "packages/workflow-runtime-vercel/test-app",
            sourceFilesOutsideRootDirectory: true,
            installCommand: "pnpm install --frozen-lockfile",
            buildCommand: "pnpm build",
            // This disposable app must be reachable by the infrastructure test.
            ssoProtection: null,
          }),
        });
        const project = Schema.decodeUnknownSync(Project)(await response.json());
        return { projectId: project.id, url: "" };
      }),
    read: ({ output }) =>
      Effect.tryPromise(async () => {
        if (!output) return undefined;
        const response = await api(`/v9/projects/${output.projectId}`, {}, true);
        return response.status === 404 ? undefined : output;
      }),
    reconcile: ({ output }) =>
      Effect.tryPromise(async () => {
        if (!output) throw new Error("Vercel project was not created");
        const token = required("VERCEL_TOKEN");
        try {
          const { stdout } = await exec(
            "pnpm",
            [
              "exec",
              "vercel",
              "deploy",
              "--yes",
              "--prod",
              "--token",
              token,
              "--cwd",
              fileURLToPath(new URL("../../../", import.meta.url)),
            ],
            {
              cwd: fileURLToPath(new URL("./", import.meta.url)),
              env: {
                ...process.env,
                VERCEL_PROJECT_ID: output.projectId,
                VERCEL_ORG_ID: required("VERCEL_ORG_ID"),
              },
              timeout: 600_000,
              maxBuffer: 10 * 1024 * 1024,
            },
          );
          const url = stdout
            .trim()
            .split(/\s+/)
            .findLast((line) => line.startsWith("https://"));
          if (!url) throw new Error("Vercel CLI did not return a deployment URL");
          return { ...output, url };
        } catch (error) {
          throw new Error(String(error).replaceAll(token, "[REDACTED]"));
        }
      }),
    delete: ({ output }) =>
      Effect.tryPromise(async () => {
        await api(`/v9/projects/${output.projectId}`, { method: "DELETE" }, true);
      }),
  });

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Vercel infrastructure test`);
  return value;
}

async function api(path: string, init: RequestInit = {}, allowMissing = false) {
  const url = new URL(path, "https://api.vercel.com");
  url.searchParams.set("teamId", required("VERCEL_ORG_ID"));
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${required("VERCEL_TOKEN")}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && !(allowMissing && response.status === 404)) {
    throw new Error(
      `Vercel ${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`,
    );
  }
  return response;
}
