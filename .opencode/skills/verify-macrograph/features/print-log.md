# Inspector Print output

- **Feature ID:** `inspector.print-log`
- **Status:** Covered
- **Mode:** `print-log`
- **Command:** `pnpm verify:playground:print-log`

## User-visible contract

The right sidebar shows the existing inspector under a **Properties** header and a **Print** section below it. The Print section lists logs emitted by nodes (such as the Utilities Print node) during tracked runtime events, newest first, each with its timestamp and the name of the node that logged it. Clicking the node name opens its graph in the focused pane, centres the canvas on the node, and selects it. Entries from deleted nodes show "Deleted node" and are not clickable.

## Assertions and evidence

The harness imports `print-project.json` (a one-second Tick wired to a Print node positioned off-screen), waits for at least two Print entries, and checks their timestamps are in descending order. It clicks the node name, asserts the graph tab opens, the node appears in Properties, and its centre lies inside the viewport. It then deletes the node and asserts its entries become non-navigable. Evidence includes `print-log-navigated.png`, `print-log-deleted.png`, the imported project, and the server log.
