# Local function queues

The `function-queues` mode opens the dedicated Queues workspace pane, creates a generic local queue
without assigning a function, and verifies its live active, paused, and resumed states through the
production editor RPC path. Add to Queue nodes choose a function per queued item, so one queue can
contain calls to different functions with different data.

The mode runs at a touch-enabled mobile viewport, creates a function and graph, adds an Add to Queue
node through the canvas menu, opens the mobile inspector, and selects both the queue and function
through the real property controls.

Evidence includes a screenshot and the playground server log.
