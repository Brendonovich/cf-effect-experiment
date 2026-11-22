import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Logger } from "effect";
import { FetchHttpClient } from "effect/http";

import { Cli } from "./Cli.ts";

Cli.run.pipe(
  Effect.catchTag(["ServiceError", "ServiceConfigError"], (error) =>
    Effect.sync(() => {
      process.stderr.write(`macrograph: ${error.message}\n`);
      process.exitCode = 1;
    }),
  ),
  // Standard output carries command results and the MCP transport, so logs go to stderr.
  Effect.provideService(Logger.LogToStderr, true),
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  NodeRuntime.runMain,
);
