# Local graph persistence and export

- **Feature ID:** `project.graph.local-persistence-export`
- **Status:** Covered
- **Mode:** `journey`
- **Command:** `pnpm verify:playground:journey`

## User journey

1. Create a graph through the New graph action.
2. Export and verify that exactly one named graph exists.
3. Rename the graph through its context menu.
4. Wait for the renamed data to reach browser storage.
5. Reload the real app and verify that the renamed graph remains visible.
6. Export again and verify that the persisted graph name is present.

## Evidence

The run records `created-project.json`, `persisted-project.json`, `persistence-export.png`, `playground.log`, and content hashes in `manifest.json`. Success requires every manifest check to pass, with no uncaught page errors, unexpected console/HTTP errors, or failed browser requests.
