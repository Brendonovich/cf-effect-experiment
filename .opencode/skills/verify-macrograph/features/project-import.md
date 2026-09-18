# Project import

- **Feature ID:** `project.import`
- **Status:** Covered
- **Automated mode:** `journey`

## Verified contract

Importing a valid project export through the playground UI replaces the current local project and displays the imported graph state after reload.

The journey imports its prior export through the file input, accepts the replacement confirmation, waits for navigation, and exports again to prove the graph was restored. Invalid input and confirmation cancellation remain outside current coverage.
