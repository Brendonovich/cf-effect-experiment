# Project Custom Events

Browser and standalone server projects support project-wide named custom events using the existing String, Int, Float, Bool, DateTime, List, and Option pin types. Cloudflare authoring and execution are deliberately not enabled.

Use the editor's **Events** navigation tab to create an event and its typed fields. Save creates **Emit <name>** and **On <name>** entries under **Project Events** in the normal node creation menu. Both are user-creatable in any graph; an event does not own a graph or a system-only handler node. Connect an existing event source (for example Utilities Tick) to Emit, set or connect its typed inputs, and connect On's execution and payload outputs to your handler.

Event and field IDs are stable, persisted identifiers. Nodes reference `emit:<event-id>` or `on:<event-id>`, and payload ports use `field:<field-id>`. Names are labels only: renaming preserves references, connections, and valid defaults. Removing fields or changing their types removes incompatible wires/defaults across all affected graphs in the same persisted editor mutation. Event deletion is rejected while Emit/On nodes reference it; remove those nodes first. Names are unique case-insensitively within their registry. Imported definitions are validated too.

Each matching On node launches a separate execution, with its own execution state, trace ID, and live activity record. Emit does not await handlers and handler failures do not propagate to the emitter or cancel sibling handlers. Handlers use the project snapshot captured by the emission; subsequent edits affect subsequent emissions. Fibers belong to the browser connection/standalone host scope and are interrupted when that runtime closes. Executions are not queued durably or resumed after process restart. Recursive event graphs can keep emitting, so avoid unconditional feedback loops.

The registry is saved with project metadata in JSON, browser localStorage/export files, and SQLite (`custom_events`, via a generated migration). Older persisted projects decode with an empty registry. Collaborative updates include the registry, changed graphs/IO, and refreshed node catalog. Concurrent definition saves use the existing serialized editor mutation policy (last completed save wins).

This release exposes graph-node emission only. Dedicated manual event buttons, public API triggers, cross-instance delivery, custom structs/enums, and Cloudflare execution are not included. Existing plugin events and their replay controls remain unchanged; custom handler activity is displayed but not replayable.
