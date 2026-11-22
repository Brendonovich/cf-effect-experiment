import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The bundle inlines every dependency and ships native addons inside dist/modules, so the
// published manifest must not carry this workspace's dependencies or pnpm protocols.
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const out = join(dist, "npm");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const directory of ["esm", "client", "modules"])
  await cp(join(dist, directory), join(out, directory), { recursive: true });
await cp(join(root, "README.md"), join(out, "README.md"));

const published = {
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  homepage: manifest.homepage,
  repository: manifest.repository,
  type: manifest.type,
  main: "./esm/index.js",
  bin: { macrograph: "./esm/index.js" },
  files: ["esm", "client", "modules"],
  engines: manifest.engines,
  publishConfig: { access: "public" },
};

await writeFile(join(out, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
console.log(`Packed ${published.name}@${published.version} into ${out}`);
