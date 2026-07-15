import { Project } from "@macrograph/core";
import { Effect, Layer } from "effect";
import { Rpc, RpcClient, RpcGroup } from "effect/unstable/rpc";

class DataInRef {}
class ExecInRef {}
class ExecOutRef {}

type IOContext = {
  data: {
    in: (id: string, data?: { name?: string }) => DataInRef;
  };
  exec: {
    in: (id: string, data?: { name?: string }) => ExecInRef;
    out: (id: string, data?: { name?: string }) => ExecOutRef;
  };
};

type RunContext<IO, Engines extends Record<string, Engine.Def<any>>> = {
  io: IO;
  engine: { [K in keyof Engines]: RpcClient.RpcClient<RpcGroup.Rpcs<Engines[K]["rpcs"]>> };
};

type PluginContext<Engines extends Record<string, Engine.Def<any>>> = {
  schema: {
    register: <IO>(schema: {
      id: string;
      io: (ctx: IOContext) => IO;
      run: (ctx: RunContext<IO, Engines>) => Effect.Effect<void>;
    }) => Effect.Effect<void>;
  };
};

type Plugin<Engines extends Record<string, any> = Record<string, never>> = {
  id: string;
  engines?: Engines;
  effect: (ctx: PluginContext<Engines>) => Effect.Effect<void>;
};

namespace ProjectRuntime {
  export const make = Effect.fnUntraced(function* (project: Project.Model) {
    return {
      plugin: Effect.fnUntraced(function* <Engines extends Record<string, any>>(
        plugin: Plugin<Engines>,
      ) {}),
    };
  });
}

namespace Engine {
  export function define<RPC extends Rpc.Any>(engine: { rpcs: RpcGroup.RpcGroup<RPC> }): Def<RPC> {
    return {
      ...engine,
      toLayer: (effect) => {},
    };
  }

  export type Def<RPC extends Rpc.Any> = {
    rpcs: RpcGroup.RpcGroup<RPC>;
    toLayer: (effect: Effect.Effect<{ rpcs: Layer.Layer<Rpc.ToHandler<RPC>> }>) => void;
  };
}

const HttpEngineRpcs = RpcGroup.make(Rpc.make("HttpGet", {}));
const HttpEngine = Engine.define({
  rpcs: HttpEngineRpcs,
});

const HttpEngineImpl = HttpEngine.toLayer(
  Effect.gen(function* () {
    return {
      rpcs: HttpEngineRpcs.toLayer({
        HttpGet: () => Effect.gen(function* () {}),
      }),
    };
  }),
);

Effect.gen(function* () {
  const project = Project.empty();
  const runtime = yield* ProjectRuntime.make(project);

  yield* runtime.plugin(
    {
      id: "http",
      engines: {
        http: HttpEngine,
      },
      effect: Effect.fnUntraced(function* (ctx) {
        yield* ctx.schema.register({
          id: "get",
          io: (ctx) => {
            return ctx.exec.in("url");
          },
          run: (ctx) =>
            Effect.gen(function* () {
              yield* ctx.engine.http.HttpGet();
            }),
        });
      }),
    },
    HttpEngineImpl,
  );
}).pipe(Effect.runFork);
