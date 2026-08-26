---
name: SolidJS v2
description: Load whenever doing frontend/UI logic in this repository, including writing, changing, debugging, or reviewing Solid v2 components, event handling, state, signals, memos, effects, props, or other reactive code.
---

# Solid v2

- Use Solid v2 APIs and the versions installed in this repository. Do not apply Solid v1 patterns from memory.
- `createEffect` takes two arguments: a reactive source and a callback. Write `createEffect(() => props.value, (value) => { ... })`, not `createEffect(() => { ... })`.
  - To add cleanup to an efect, return a function. Do not use onSettled, that is the equivalent of onMount from Solid v1.
- Component bodies are not reactive scopes. Do not eagerly read props, signals, stores, or memos into local values there. Read them in JSX or inside a reactive primitive such as `createMemo` or the source passed to `createEffect`.
- `<Show>` and `<For>` render callbacks are not reactive tracking scopes either. Never eagerly read signals, stores, query results, or other reactive values directly in their callback bodies. Wrap derived values in `createMemo(() => ...)` and read the memo in JSX, or read the reactive value directly in JSX; otherwise Solid emits `[STRICT_READ_UNTRACKED]` and the derived value will not update.
- Keep reactive values as accessors until the tracked point. Prefer `const label = createMemo(() => props.name.trim())` over `const label = props.name.trim()`.
- Derive state instead of mirroring it with effects. Use derived signals/accessors and store getters for synchronous state, and async memos such as `createMemo(async () => ...)` for asynchronous state.
- Preserve the repository's existing Solid patterns and confirm unfamiliar APIs against the installed Solid v2 types before using them.
