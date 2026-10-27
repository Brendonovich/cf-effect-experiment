"use strict";
const path = require("node:path");

exports.default = { kind: "node-builtin", joined: path.posix.join("a", "b") };
