# MacroGraph

MacroGraph is a pnpm monorepo for authoring and running typed visual automation graphs across the browser, self-hosted server, and Cloudflare runtimes.

## Source of Truth

- Effect v4 changes quickly. Inspect the checked-in `lib/effect-smol` submodule instead of relying on remembered APIs. Start with `packages/effect/src/Schema.ts`, `Effect.ts`, and `Layer.ts`, then read the relevant package source.
- Prefer current code, public package exports, tests, and generated schemas over prose descriptions of implementation details.

## Workflow

- Follow the user's requested order; do not silently reorder work.
- Backwards compatibility is not required at this stage. Prefer a clean design over compatibility layers, legacy fallbacks, or migrations for old APIs and saved formats unless explicitly requested.
- Keep changes scoped. Do not modify, discard, or incorporate unrelated worktree changes.

## Coding

- Never use `as any`. Use branded constructors such as `NodeId.make(value)` or restructure the types.
- Never mutate `Schema.Class` instances. Construct a new instance with the changed fields.
- Keep entity not-found errors in `@macrograph/core` under their namespace, such as `Project.NotFoundError`, `Graph.NotFoundError`, and `Node.NotFoundError`.
- Define class-based services as `Context.Service` classes and expose their interface through the namespace. Inline private service implementations in `Layer.effect`; extract a `make` function only when it is exported.
- Generate database migrations with `drizzle-kit generate`. Do not hand-write migration SQL. Use `DatabaseSync` transactions for atomic SQLite writes.
- Track client actions with TanStack Query `useMutation`, deriving pending and error state from the mutation. Set mutation `networkMode` to `"always"`; connectivity belongs in the transport layer.

## Build and Verification

Run the narrowest relevant test while developing, then use the repository commands below as the supported verification interface.

| Situation | Command |
| --- | --- |
| Any code change | `pnpm typecheck` |
| Changed packages and dependents | `pnpm test:affected` |
| Full unit and type validation | `pnpm check:fast` |
| PR or release readiness | `pnpm check:ci` |
| Formatting | `pnpm format` |

- Verify observable behavior through the real artifact; compilation alone is not proof of runtime or user-visible behavior.
- Do not declare completion when required verification could not run. Report the blocker and what remains unverified.

## Skills

| Skill | Use when |
| --- | --- |
| `.opencode/skills/verify-macrograph/SKILL.md` | A change affects the playground UI, editor startup, local persistence, import/export, reset, or another behavior covered by its feature map. |

For playground verification, run `doctor`, select the relevant file under `.opencode/skills/verify-macrograph/features/`, exercise the production user path, and report the generated manifest and evidence paths. Screenshots alone are not proof. Update the feature map in the same change when covered user behavior changes.
