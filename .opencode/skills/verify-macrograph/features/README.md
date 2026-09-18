# MacroGraph playground feature coverage

Use this map to choose the narrowest real-browser verification. A feature is only **covered** when the linked automated mode asserts its outcome and records evidence in the run manifest. **Planned** features are not verified by the current harness.

| Feature                                  | Status  | Mode      | Details                                                    |
| ---------------------------------------- | ------- | --------- | ---------------------------------------------------------- |
| Browser playground boots                 | Covered | `smoke`   | [playground-boot.md](playground-boot.md)                   |
| Graph changes persist locally and export | Covered | `journey` | [local-persistence-export.md](local-persistence-export.md) |
| Import replaces the local project        | Covered | `journey` | [project-import.md](project-import.md)                     |
| Reset clears the local project           | Covered | `journey` | [project-reset.md](project-reset.md)                       |

Run `pnpm verify:playground` for all covered features. The machine-readable index is `tools/verify-macrograph/feature-map.json`.

Use `pnpm list:affected` or `pnpm test:affected` for changed workspace packages and their dependents. The browser feature map documents product behavior, not source-file ownership.
