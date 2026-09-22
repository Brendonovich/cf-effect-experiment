# Module info, engine, and node reference

- **Feature ID:** `module.reference`
- **Status:** Covered
- **Mode:** `module-reference`
- **Command:** `pnpm verify:playground:module-reference`

## User-visible contract

Focusing a module shows its name, description, ID, public schema breakdown, and resource count under a concise "Module" title in the right inspector. Module panes provide **Engine** and **Reference** tabs. Reference lists resources above exposed nodes in a searchable left sidebar, using the same section headers while reserving color markers for node variants. Selecting a node shows its details, rendered preview, wildcard type controls (including project custom types), and configurable value properties on the right. Changing a property regenerates property-dependent preview ports. Selecting the rendered preview and using the normal copy shortcut places a pasteable node with those configured properties on the clipboard. Selecting a resource shows its details. The selected module view and reference item persist with that pane.

## Assertions and evidence

Reference copying is verified end-to-end: the normal paste shortcut inserts the copied preview into a new graph, and `reference-paste-project.json` confirms the new node ID, schema, and configured properties. The harness records `reference-paste.png` before deleting the temporary graph. Component regressions decode both generated/configured previews and a LIFX resource-node preview through `Clipboard.decode`, the same strict parser used by paste, preserving resource properties and port defaults while excluding schema metadata from `nodeIO`.

The harness searches modules by node metadata (Concat), clears the search, and checks that the journey emits no `HUGE_FAN_IN` diagnostics. It opens the Utilities module's **Engine** settings, stops and starts the Tick engine, and confirms the displayed runtime state updates. It then confirms the module metadata under the "Module" title in the right inspector, selects **Reference**, searches for Concat, confirms unrelated nodes are filtered out, selects the Concat Strings node, reloads, confirms both selections and the rendered graph node remain, copies the preview with the platform shortcut, validates the clipboard fragment, and records `module-reference.png`, `playground.log`, and their hashes in `manifest.json`. `ModuleSettingsView.test.tsx` additionally runs a settings mutation without an external provider, verifies resource filtering, selects a project-defined custom wildcard type, changes a numeric property, confirms both changes update the rendered preview, and verifies copying the selected preview preserves its configured properties.
