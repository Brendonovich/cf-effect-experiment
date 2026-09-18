import assert from "node:assert/strict";
import test from "node:test";

import { isUnexpectedConsoleProblem } from "./diagnostics.mjs";

test("treats Solid untracked-read warnings as unexpected console problems", () => {
  assert.equal(
    isUnexpectedConsoleProblem({
      type: "warning",
      text: "[STRICT_READ_UNTRACKED] Reactive value read directly in an effect callback",
    }),
    true,
  );
});

test("allows unrelated console warnings", () => {
  assert.equal(isUnexpectedConsoleProblem({ type: "warning", text: "deprecated API" }), false);
});
