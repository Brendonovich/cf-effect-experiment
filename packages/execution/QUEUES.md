# Queues

Queues schedule calls to project function graphs. They do not contain graph bodies.

Queue definitions (`id`, `name`) are project metadata and are included in JSON,
browser storage, SQLite, and deployment snapshots. Realtime waiting/running work
and pause state belong to the project host lifetime and are not restored after
restart. Host shutdown fails waiting callers.

Automatic dispatch is FIFO and starts work only when nothing is running. Pause
stops dispatch without interrupting running calls. Advance requires an unpaused
queue and starts exactly one waiting call even while other calls run. Automatic
dispatch resumes only after all overlapping calls finish.

Function failures, defects, removal, clear, deleted queues, and interruption settle
waiting callers with failure. Removal and clear cancel running calls; cleanup
remains counted as running until interruption completes. A failing call never
silently returns empty results. At most 500 calls may wait; overflow rejects the
new call without discarding older calls.

Add to Queue captures the selected function's typed arguments before waiting and
continues execution with its results after completion. Runtime values are encoded
using the signature's JSON codecs before capture and decoded before invocation.
This preserves values such as Effect DateTime across transport boundaries.

Awaited enqueue onto any ancestor queue is rejected, including indirect queue
lineage cycles. Different queues and different project hosts are independent.

The editor's Queues section exposes queue definitions, waiting/running function
names, Pause/Resume, Advance, Remove, Clear, and Delete. All mutation RPCs require
editor write access. Runtime snapshots omit captured arguments and results.

Cloudflare transport and deployment prerequisites are documented separately in
the cloud application. Cloud execution uses actual Cloudflare Queues and delegates
function execution/result durability to Workflows, not the realtime scheduler.
