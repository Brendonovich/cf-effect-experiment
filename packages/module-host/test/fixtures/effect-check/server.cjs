"use strict";
const Effect = require("effect/Effect");
const effect = require("effect");
const ModuleId = require("@macrograph/module/ModuleId");

exports.default = {
  kind: "effect-check",
  Effect,
  effect,
  ModuleId,
  program: Effect.succeed(42),
};
