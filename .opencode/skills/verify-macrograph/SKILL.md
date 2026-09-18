---
name: verify-macrograph
description: Deterministically verify the real MacroGraph playground UI and collect agent-readable evidence.
---

# Verify MacroGraph

Use the project-local harness rather than ad hoc browser state when checking playground behavior.

1. Run `pnpm verify:doctor` before the first verification in an environment.
2. Use `pnpm list:affected` or `pnpm test:affected` for package-level impact since `origin/main`.
3. Run the narrowest useful browser mode:
   - `pnpm verify:playground:smoke` for app startup and editor visibility.
   - `pnpm verify:playground:journey` for local graph persistence and export.
   - `pnpm verify:playground` for both.
4. Read the manifest path printed by the command. Treat `status`, every item in `checks`, browser errors, and evidence hashes as the verification result.
5. Report the exact manifest and evidence paths. Do not claim success from screenshots alone.

The harness owns and cleans up its temporary Chromium profile and Vite child process. Do not point it at an existing browser profile or shared app process. Do not delete artifacts from other runs.

Read `.opencode/skills/verify-macrograph/features/README.md` for agent-readable coverage and journey details. Use `tools/verify-macrograph/feature-map.json` when a machine-readable index is more useful.
Package selection does not prove product-feature coverage. The inexpensive browser journey remains unconditional in CI.
