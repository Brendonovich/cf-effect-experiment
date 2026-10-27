const { Effect } = require("effect");
const { Module } = require("@macrograph/module");

exports.default = Module.make({ name: "Hello fixture", effect: () => Effect.void });
