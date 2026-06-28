# Macrograph

## Effect API Reference

The Effect v4 monorepo is checked in as a git submodule at `lib/effect-smol` (effect-ts/effect-smol, on branch `@effect/ai-anthropic@4.0.0-beta.66`). Use this submodule to look up Effect APIs when writing or refactoring code. Key entry points:

- `packages/effect/src/Schema.ts` — Schema, Schema.Class, Schema.Struct, brands, etc.
- `packages/effect/src/Effect.ts` — core Effect module
- `packages/effect/src/Layer.ts` — Layer module
- Other packages under `packages/` for platform, sql, cli, rpc, etc.

## Hard Rules

- **NEVER use `as any`**. Use `{BrandedType}.make(value)` for branded types, or restructure types to avoid the cast.
- **NEVER mutate Schema.Class instances**. All properties are readonly. Create new instances with `new Model({ ...existing, field: newValue })`.
- **EntityNotFoundError classes live in the core package**, under their respective namespace (`Project.NotFoundError`, `Graph.NotFoundError`, `Node.NotFoundError`).

## Effect v4 API Notes

- **`Effect.catchAll` does not exist in v4**. Use `Effect.catchCause` and filter via `Cause.findFail`. For sync error handling, prefer `Effect.try({ try, catch })`.
- **`Effect.try` requires a `catch`** — the catch handler is not optional. Use `catch: (error) => error` for pass-through.
- **`Effect.fnUntraced` returns a function**, not an Effect. Call it to get the Effect: `make()`. It also accepts piped handlers as a second arg: `Effect.fnUntraced(function*() { ... }, PersistenceError.refail)`.
- **`Schema.TaggedClass`** (not `Schema.TaggedError`) for typed tagged classes. **`Schema.TaggedErrorClass`** for tagged error classes.
- **`Result` uses `success`/`failure` properties** (not `value`/`error` from v3). `Result.Success` has `.success`, `Result.Failure` has `.failure`.
- **`Context.Service` class-based services**: each file exports `class Service extends Context.Service<Service, { ... }>()("key") {}` and `export * as X from "./X.js"` at the bottom.

## Layer Composition

- **Use `Layer.effect(Tag)(effect)` (curried form)** to avoid `NoInfer` type inference issues with the two-arg form.
- **Per-project layers over global ones**: `DrizzleLayer.layer(basePath, projectId)` scopes a layer to a specific project. `drizzle.use(impl)` doesn't need a projectId param.

## Schema & Branded Types

- **Branded types have `.make()`**: `NodeId.make("some-id")`, `GraphId.make("some-id")`, etc. Don't cast strings with `as any`.
- **Schema.Struct for inline types**: `Schema.Struct({ id: Schema.String, name: Schema.String })` for simple metadata schemas.
- **`Schema.decodeUnknownEffect` / `Schema.encodeUnknownEffect`** for serialization. For Schemas with no service requirements, both produce `Effect<A, SchemaError>`.

## Drizzle + SQLite

- **Use `drizzle-kit generate`** for migrations, not raw `CREATE TABLE` SQL.
- **Per-project SQLite files**: no `projects` table, just a `project_meta` (single-row `name`) and `graphs`/`nodes` tables. One `.sqlite` file per project.
- **Drizzle `db:generate` script** in package.json: `"db:generate": "drizzle-kit generate"`. Config at `drizzle.config.ts`.
- **`node:sqlite`'s `DatabaseSync`** with `drizzle-orm/node-sqlite` driver. Use `db.transaction((tx) => { ... })` for atomic writes, not manual BEGIN/COMMIT.

## Persistence

- **`PersistenceError`** has `{ cause: Schema.Defect }`. Its `refail` static method catches any `Cause` via `Effect.catchCause` and wraps with `Cause.squash`.
- **`withMemoryBuffer(layer)` wraps a persistence layer** with an in-memory `Ref<Map<ProjectId, Project.Model>>` cache — load hits cache first, saves update it.
- **`saveGraph` is for efficiency** — writes a single graph without touching the full project on disk. For JSON, it writes one file; for SQLite, one transaction.

## Service Implementation

- **Don't extract private `make` functions**. Inline the implementation directly in `Layer.effect(Service, Effect.gen(function* () { ... }))` unless the `make` function is exported.

## Verification

- **Always run `pnpm typecheck` after making changes** to ensure types are correct.
