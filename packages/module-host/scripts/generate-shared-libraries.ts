import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { generate, outputFile } from "./shared-libraries.ts";

writeFileSync(outputFile, generate());
// Keep the committed file in the repository's formatting (the formatter sorts the imports).
execFileSync("pnpm", ["exec", "vp", "fmt", outputFile, "--write"], { stdio: "inherit" });
console.log(`Wrote ${outputFile}`);
