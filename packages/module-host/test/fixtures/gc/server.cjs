"use strict";
const { Effect } = require("effect");

// Large enough that a leak per load would be obvious, small enough to load many times.
const payload = Array.from({ length: 100_000 }, (_, index) => ({ index }));

exports.default = {
  kind: "gc",
  payload,
  program: Effect.sync(() => payload.length),
};
