import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (
  version === undefined ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)
) {
  console.error("usage: set-version.mjs <semver>");
  process.exit(1);
}

const packagePath = new URL("../package.json", import.meta.url);
const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
writeFileSync(packagePath, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
writeFileSync(
  new URL("../src/Version.ts", import.meta.url),
  `/** The server's release version; kept equal to package.json by a test. */\nexport const version = ${JSON.stringify(version)};\n`,
);
console.log(`@macrograph/cli@${version}`);
