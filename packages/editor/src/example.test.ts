import { Graph, Project } from "@macrograph/core";
import { Context, Data, Effect, Layer, Ref } from "effect";
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

namespace Persistence {
  export class PersistenceError extends Data.TaggedError("PersistenceError")<{}> {}

  export interface Interface {
    getProject: Effect.Effect<Project.Model, PersistenceError>;
    saveProject: (project: Project.Model) => Effect.Effect<void, PersistenceError>;
    saveGraph: (graph: Graph.Model) => Effect.Effect<void, PersistenceError>;
  }

  export class Service extends Context.Service<Service, Interface>()(
    "@macrograph/editor/ProjectEditor",
  ) {}

  export const layerMemory = (project: Project.Model) =>
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const projectRef = yield* Ref.make(project);

        return {
          getProject: Effect.gen(function* () {
            return yield* Ref.get(projectRef);
          }),
          saveProject: Effect.fnUntraced(function* (project) {
            yield* Ref.set(projectRef, project);
          }),
          saveGraph: Effect.fnUntraced(function* (graph) {
            yield* Ref.update(projectRef, (project) => ({
              ...project,
              graphs: {
                ...project.graphs,
                [graph.id]: graph,
              },
            }));
          }),
        };
      }),
    );
}

namespace ProjectEditor {
  export interface Interface {
    graph: {
      create: (opts: { name: string }) => Effect.Effect<void, Persistence.PersistenceError>;
      update: () => Effect.Effect<void, Persistence.PersistenceError>;
      delete: () => Effect.Effect<void, Persistence.PersistenceError>;
    };
    node: {
      create: () => Effect.Effect<void, Persistence.PersistenceError>;
      update: (opts: {
        graphID: string;
        nodeID: string;
        name?: string;
        position?: { x: number; y: number };
        ephemeral?: boolean;
      }) => Effect.Effect<void, Persistence.PersistenceError>;
      delete: () => Effect.Effect<void, Persistence.PersistenceError>;
    };
    plugin: <Engines extends Record<string, any>>(plugin: Plugin<Engines>) => Effect.Effect<void>;
  }

  export class Service extends Context.Service<Service, Interface>()(
    "@macrograph/editor/ProjectEditor",
  ) {}

  export const make = Effect.fn(function* () {
    const persistence = yield* Persistence.Service;

    return Service.of({
      graph: {
        create: Effect.fn(function* (opts) {
          const id = Graph.GraphId.make(Math.random().toString(36).slice(0, 8));

          yield* persistence.saveGraph(
            Graph.Model.make({ id, name: opts.name, nodes: {}, connections: [] }),
          );
        }),
        update: Effect.fn(function* () {}),
        delete: Effect.fn(function* () {}),
      },
      node: {
        create: Effect.fn(function* () {}),
        update: Effect.fn(function* (opts) {
          void opts;
        }),
        delete: Effect.fn(function* () {}),
      },
      plugin: Effect.fnUntraced(function* (plugin) {
        void plugin;
      }),
    });
  });

  export const layer = () => Layer.effect(Service, make());
}

namespace Engine {
  export function define<RPC extends Rpc.Any>(engine: { rpcs: RpcGroup.RpcGroup<RPC> }): Def<RPC> {
    return engine;
  }

  export type Def<RPC extends Rpc.Any> = {
    rpcs: RpcGroup.RpcGroup<RPC>;
  };
}

const HttpEngine = Engine.define({
  rpcs: RpcGroup.make(Rpc.make("HttpGet", {})),
});

const EditorLive = ProjectEditor.layer().pipe(
  Layer.provide(Persistence.layerMemory(Project.empty())),
);

Effect.gen(function* () {
  const editor = yield* ProjectEditor.Service;

  yield* editor.plugin({
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
  });

  yield* editor.graph.create({ name: "Test" });
  yield* editor.node.create();

  yield* editor.node.update({
    graphID: "1234",
    nodeID: "5678",
    name: "Name",
    position: { x: 10, y: 10 },
  });

  yield* editor.node.delete();
  yield* editor.graph.delete();

  yield* editor.plugin({
    id: "console",
    engines: {},
    effect: Effect.fnUntraced(function* (ctx) {
      yield* ctx.schema.register({
        id: "log",
        io: (ctx) => {
          return ctx.data.in("data");
        },
        run: Effect.fnUntraced(function* ({ io }) {
          yield* Effect.log(io);
        }),
      });
    }),
  });
}).pipe(Effect.provide(EditorLive), Effect.runFork);
