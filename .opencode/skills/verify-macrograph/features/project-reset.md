# Project reset

- **Feature ID:** `project.reset`
- **Status:** Covered
- **Automated mode:** `journey`

## Verified contract

Resetting through the playground UI clears the local project and the cleared state remains after reload.

The journey activates Reset, accepts confirmation, waits for navigation, verifies the empty graph state, and exports the reset project as evidence. Confirmation cancellation remains outside current coverage.
