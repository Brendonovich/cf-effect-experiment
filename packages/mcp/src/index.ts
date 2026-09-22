import { Cause, Context, Effect, Layer, Sink, Stream } from "effect";
import { McpProtocol, McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";

export { ProjectToolkit } from "./ProjectToolkit.ts";

export interface ServerOptions {
  readonly name: string;
  readonly version: string;
  readonly path: string;
}

export const layer = <
  const Tools extends Record<string, Tool.Any>,
  Handlers extends Toolkit.HandlersFrom<Tools>,
>(
  toolkit: Toolkit.Toolkit<Tools>,
  handlers: Handlers,
  options: ServerOptions,
  withRequestContext: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
) => {
  if (!options.path.startsWith("/")) throw new Error("MCP HTTP paths must start with /");
  const path: `/${string}` = `/${options.path.slice(1)}`;
  const registration = Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* McpServer.McpServer;
      const built = yield* toolkit;

      for (const tool of Object.values(built.tools)) {
        const outputSchema = Tool.getJsonSchemaFromSchema(tool.successSchema);
        yield* registry.addTool({
          tool: new McpSchema.Tool({
            name: tool.name,
            description: Tool.getDescription(tool),
            inputSchema: Tool.getJsonSchema(tool),
            ...(outputSchema.type === "object" ? { outputSchema } : {}),
            annotations: {
              readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
              destructiveHint: Context.get(tool.annotations, Tool.Destructive),
              idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
              openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
            },
          }),
          annotations: tool.annotations,
          handle: (payload) =>
            withRequestContext(
              built.handle(tool.name, payload).pipe(
                Stream.unwrap,
                Stream.run(Sink.last()),
                Effect.flatMap(Effect.fromOption),
                Effect.map(
                  (result) =>
                    new McpSchema.CallToolResult({
                      isError: false,
                      structuredContent:
                        typeof result.encodedResult === "object" ? result.encodedResult : undefined,
                      content: [{ type: "text", text: JSON.stringify(result.encodedResult) }],
                    }),
                ),
              ),
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.succeed(
                  new McpSchema.CallToolResult({
                    isError: true,
                    content: [{ type: "text", text: Cause.pretty(cause) }],
                  }),
                ),
              ),
            ),
        });
      }
    }),
  ).pipe(Layer.provide(toolkit.toLayer(handlers)));

  return registration.pipe(
    Layer.provide(
      McpServer.layerHttp({
        ...options,
        path,
        protocols: [McpProtocol.v2025_06_18],
      }).pipe(Layer.orDie),
    ),
  );
};
