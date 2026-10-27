/**
 * Bundle checks for module packages. Pure and platform-neutral (no Node APIs), so the
 * official registry can run them on uploaded tarballs at publish time.
 */
import { parse } from "@babel/parser";
import { Manifest } from "@macrograph/module/Manifest";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import { Exit, Schema } from "effect";

export type IssueCode =
  | "invalid-manifest"
  | "missing-file"
  | "unexpected-file"
  | "invalid-syntax"
  | "top-level-await"
  | "shared-library-copy"
  | "unresolvable-require"
  | "undeclared-node-builtin"
  | "dynamic-require"
  | "unshared-import"
  | "module-scope-global"
  | "size-limit";

export interface Issue {
  readonly severity: "error" | "warning";
  readonly code: IssueCode;
  readonly message: string;
  readonly path?: string;
}

export interface Limits {
  /** Maximum size of `server.cjs`. */
  readonly serverBytes: number;
  /** Maximum combined size of everything under `ui/`. */
  readonly uiBytes: number;
  /** Maximum combined size of everything under `assets/`. */
  readonly assetsBytes: number;
  /** Maximum size of the whole package folder. */
  readonly totalBytes: number;
}

const MiB = 1024 * 1024;

export const defaultLimits: Limits = {
  serverBytes: 16 * MiB,
  uiBytes: 8 * MiB,
  assetsBytes: 4 * MiB,
  totalBytes: 24 * MiB,
};

export interface File {
  /** Forward-slash path relative to the package folder, e.g. `ui/index.js`. */
  readonly path: string;
  readonly contents: string | Uint8Array;
}

export const hasErrors = (issues: ReadonlyArray<Issue>) =>
  issues.some((issue) => issue.severity === "error");

export const errors = (issues: ReadonlyArray<Issue>) =>
  issues.filter((issue) => issue.severity === "error");

export const format = (issue: Issue) =>
  `${issue.severity} [${issue.code}]${issue.path === undefined ? "" : ` ${issue.path}`}: ${issue.message}`;

const error = (code: IssueCode, message: string, path?: string): Issue =>
  path === undefined
    ? { severity: "error", code, message }
    : { severity: "error", code, message, path };

const warning = (code: IssueCode, message: string, path?: string): Issue =>
  path === undefined
    ? { severity: "warning", code, message }
    : { severity: "warning", code, message, path };

const textDecoder = new TextDecoder();
const text = (contents: string | Uint8Array) =>
  typeof contents === "string" ? contents : textDecoder.decode(contents);
const textEncoder = new TextEncoder();
const byteLength = (contents: string | Uint8Array) =>
  typeof contents === "string" ? textEncoder.encode(contents).byteLength : contents.byteLength;

/** Packages whose copies must never be bundled for a target, e.g. `effect`, `solid-js`. */
export const sharedPackages = (target: SharedLibraries.Target): ReadonlySet<string> =>
  new Set(SharedLibraries.specifiers(target).map(SharedLibraries.packageName));

/** The package a bundled file belongs to, read from the last `node_modules/` segment of its path. */
export const packageFromPath = (path: string): string | undefined => {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("node_modules/");
  if (index === -1) return undefined;
  const [first, second] = normalized.slice(index + "node_modules/".length).split("/");
  if (first === undefined || first === "") return undefined;
  return first.startsWith("@") ? (second === undefined ? undefined : `${first}/${second}`) : first;
};

/**
 * Checks a bundle graph for shared libraries that were bundled instead of left external.
 * Each entry is a module in the bundle and the package it belongs to (when known).
 */
export const sharedLibraryCopies = (
  modules: Iterable<{ readonly id: string; readonly packageName: string | undefined }>,
  target: SharedLibraries.Target,
  path?: string,
): ReadonlyArray<Issue> => {
  const shared = sharedPackages(target);
  const found = new Map<string, string>();
  for (const module of modules) {
    const name = module.packageName ?? packageFromPath(module.id);
    if (name !== undefined && shared.has(name) && !found.has(name)) found.set(name, module.id);
  }
  return [...found].map(([name, id]) =>
    error(
      "shared-library-copy",
      `Bundle contains its own copy of shared library ${name} (${id}); it must be imported from the host`,
      path,
    ),
  );
};

const regionPattern = /^\/\/#region (.+)$/gm;
const signatures: ReadonlyArray<{ readonly packageName: string; readonly pattern: RegExp }> = [
  { packageName: "effect", pattern: /=\s*["']~effect\/Effect["']/ },
];

/** Detects bundled shared libraries from the module region markers and signatures in the code. */
export const sharedLibraryCopiesInCode = (
  code: string,
  target: SharedLibraries.Target,
  path?: string,
): ReadonlyArray<Issue> => {
  const regions = [...code.matchAll(regionPattern)].map((match) => ({
    id: match[1] ?? "",
    packageName: undefined,
  }));
  const shared = sharedPackages(target);
  const signatureHits = signatures
    .filter((signature) => shared.has(signature.packageName) && signature.pattern.test(code))
    .map((signature) => ({ id: signature.packageName, packageName: signature.packageName }));
  return sharedLibraryCopies([...regions, ...signatureHits], target, path);
};

type Node = { readonly type: string; readonly [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string";

const skippedKeys = new Set([
  "loc",
  "start",
  "end",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "range",
]);

const isFunction = (node: Node) =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression" ||
  node.type === "ObjectMethod" ||
  node.type === "ClassMethod" ||
  node.type === "ClassPrivateMethod";

/** Visits every node, telling the visitor whether it sits inside a function. */
const walk = (root: Node, visit: (node: Node, inFunction: boolean) => void) => {
  const stack: Array<readonly [Node, boolean]> = [[root, false]];
  while (stack.length > 0) {
    const [node, inFunction] = stack.pop()!;
    visit(node, inFunction);
    const childInFunction = inFunction || isFunction(node);
    for (const key in node) {
      if (skippedKeys.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) stack.push([child, childInFunction]);
      } else if (isNode(value)) stack.push([value, childInFunction]);
    }
  }
};

const parseProgram = (code: string, sourceType: "module" | "script") =>
  parse(code, {
    sourceType,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    errorRecovery: false,
  }).program as unknown as Node;

const stringArgument = (node: Node): string | undefined => {
  const args = node.arguments;
  if (!Array.isArray(args)) return undefined;
  const first: unknown = args[0];
  return isNode(first) && first.type === "StringLiteral" && typeof first.value === "string"
    ? first.value
    : undefined;
};

const isRequireCall = (node: Node) => {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;
  return isNode(callee) && callee.type === "Identifier" && callee.name === "require";
};

export interface ServerEntryOptions {
  readonly path?: string;
  /** Used to check `node:*` requires against the declared `node` list. */
  readonly manifest?: Manifest.Model;
  /** Extra specifiers the host is expected to resolve. */
  readonly external?: ReadonlyArray<string>;
}

export interface ServerEntryAnalysis {
  readonly issues: ReadonlyArray<Issue>;
  /** Every literal specifier passed to `require`. */
  readonly requires: ReadonlyArray<string>;
}

/**
 * Checks a server entry: valid script syntax, no top-level await, every `require` resolvable
 * by the host, declared Node built-ins, and no copies of shared libraries.
 */
export const analyzeServerEntry = (
  code: string,
  options: ServerEntryOptions = {},
): ServerEntryAnalysis => {
  const path = options.path ?? ModulePackage.ServerEntry;
  const issues: Array<Issue> = [];
  const requires = new Set<string>();
  let program: Node;
  try {
    program = parseProgram(code, "script");
  } catch (cause) {
    return {
      issues: [
        error("invalid-syntax", `Server entry is not a valid script: ${String(cause)}`, path),
      ],
      requires: [],
    };
  }
  const external = new Set(options.external ?? []);
  const reported = new Set<string>();
  const report = (issue: Issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (reported.has(key)) return;
    reported.add(key);
    issues.push(issue);
  };
  walk(program, (node, inFunction) => {
    if (
      !inFunction &&
      (node.type === "AwaitExpression" || (node.type === "ForOfStatement" && node.await === true))
    )
      report(
        error(
          "top-level-await",
          "Server entry uses top-level await, which the host cannot evaluate",
          path,
        ),
      );
    if (
      node.type === "ImportExpression" ||
      (node.type === "CallExpression" && isNode(node.callee) && node.callee.type === "Import")
    )
      report(
        error(
          "unresolvable-require",
          "Server entry uses dynamic import(), which the host cannot evaluate; inline it",
          path,
        ),
      );
    if (node.type === "MetaProperty")
      report(
        warning(
          "module-scope-global",
          "Server entry uses import.meta, which is unavailable in the host's function wrapper",
          path,
        ),
      );
    if (!isRequireCall(node)) return;
    const specifier = stringArgument(node);
    if (specifier === undefined) {
      report(
        warning(
          "dynamic-require",
          "Server entry calls require() with a non-literal specifier",
          path,
        ),
      );
      return;
    }
    requires.add(specifier);
    if (SharedLibraries.isShared(specifier, "server") || external.has(specifier)) return;
    if (specifier.startsWith("node:")) {
      if (
        options.manifest !== undefined &&
        !Manifest.allowsNodeBuiltin(options.manifest, specifier)
      )
        report(
          error(
            "undeclared-node-builtin",
            `Server entry requires ${specifier} but the manifest's node list does not declare ${specifier.slice("node:".length)}`,
            path,
          ),
        );
      return;
    }
    report(
      error(
        "unresolvable-require",
        `Server entry requires ${specifier}, which is neither a shared library nor a node: built-in`,
        path,
      ),
    );
  });
  for (const name of ["__dirname", "__filename"])
    if (new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(code))
      report(
        warning(
          "module-scope-global",
          `Server entry references ${name}, which is undefined in the host's function wrapper`,
          path,
        ),
      );
  issues.push(...sharedLibraryCopiesInCode(code, "server", path));
  return { issues, requires: [...requires].sort() };
};

export const checkServerEntry = (code: string, options: ServerEntryOptions = {}) =>
  analyzeServerEntry(code, options).issues;

const isRelative = (specifier: string) => specifier.startsWith("./") || specifier.startsWith("../");

/** Checks a UI chunk: only relative imports and shared browser libraries, and no bundled copies of them. */
export const checkUiChunk = (code: string, path: string) => {
  const issues: Array<Issue> = [];
  let program: Node;
  try {
    program = parseProgram(code, "module");
  } catch (cause) {
    return [error("invalid-syntax", `UI chunk is not a valid ES module: ${String(cause)}`, path)];
  }
  const seen = new Set<string>();
  const checkSpecifier = (specifier: string) => {
    if (
      isRelative(specifier) ||
      SharedLibraries.isShared(specifier, "browser") ||
      seen.has(specifier)
    )
      return;
    seen.add(specifier);
    issues.push(
      error(
        "unshared-import",
        `UI imports ${specifier}, which is not a shared browser library; bundle it`,
        path,
      ),
    );
  };
  walk(program, (node) => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      node.type === "ExportNamedDeclaration"
    ) {
      const source = node.source;
      if (isNode(source) && source.type === "StringLiteral" && typeof source.value === "string")
        checkSpecifier(source.value);
      return;
    }
    if (node.type === "ImportExpression") {
      const source = node.source;
      if (isNode(source) && source.type === "StringLiteral" && typeof source.value === "string")
        checkSpecifier(source.value);
      return;
    }
    if (node.type === "CallExpression" && isNode(node.callee) && node.callee.type === "Import") {
      const specifier = stringArgument(node);
      if (specifier !== undefined) checkSpecifier(specifier);
    }
  });
  issues.push(...sharedLibraryCopiesInCode(code, "browser", path));
  return issues;
};

const sizeIssue = (label: string, size: number, limit: number, path?: string) =>
  size > limit
    ? [error("size-limit", `${label} is ${size} bytes, over the limit of ${limit} bytes`, path)]
    : [];

const isPackageFile = (path: string) =>
  path === ModulePackage.ManifestFile ||
  path === ModulePackage.ServerEntry ||
  path.startsWith(`${ModulePackage.UiDirectory}/`) ||
  path.startsWith(`${ModulePackage.AssetsDirectory}/`);

export interface PackageOptions {
  readonly limits?: Partial<Limits>;
  readonly external?: ReadonlyArray<string>;
  /** `api` versions the checker accepts; any when omitted. */
  readonly supportedApis?: ReadonlyArray<number>;
}

export interface PackageResult {
  readonly manifest: Manifest.Model | undefined;
  readonly issues: ReadonlyArray<Issue>;
}

/**
 * Checks a whole package folder given its files: manifest, layout, server entry, UI chunks
 * and size limits.
 */
export const checkPackage = (
  files: ReadonlyArray<File>,
  options: PackageOptions = {},
): PackageResult => {
  const limits = { ...defaultLimits, ...options.limits };
  const issues: Array<Issue> = [];
  const byPath = new Map(files.map((file) => [file.path, file]));

  const manifestFile = byPath.get(ModulePackage.ManifestFile);
  let manifest: Manifest.Model | undefined;
  if (manifestFile === undefined) {
    issues.push(error("missing-file", "Package has no manifest", ModulePackage.ManifestFile));
  } else {
    const exit = Schema.decodeUnknownExit(Schema.fromJsonString(Manifest.Model))(
      text(manifestFile.contents),
    );
    if (Exit.isSuccess(exit)) manifest = exit.value;
    else
      issues.push(
        error(
          "invalid-manifest",
          `Manifest is invalid: ${String(exit.cause)}`,
          ModulePackage.ManifestFile,
        ),
      );
  }
  if (
    manifest !== undefined &&
    options.supportedApis !== undefined &&
    !options.supportedApis.includes(manifest.api)
  )
    issues.push(
      error(
        "invalid-manifest",
        `Manifest api ${manifest.api} is not supported`,
        ModulePackage.ManifestFile,
      ),
    );

  for (const file of files)
    if (!isPackageFile(file.path))
      issues.push(error("unexpected-file", "File is outside the package layout", file.path));

  if (manifest !== undefined) {
    const required = [
      manifest.server,
      ...(manifest.ui === undefined ? [] : [manifest.ui.entry, ...manifest.ui.styles]),
      ...(manifest.icon === undefined ? [] : [manifest.icon]),
    ];
    for (const path of required)
      if (!byPath.has(path))
        issues.push(error("missing-file", "Manifest references a missing file", path));
  }

  const serverPath = manifest?.server ?? ModulePackage.ServerEntry;
  const server = byPath.get(serverPath);
  if (server !== undefined) {
    issues.push(
      ...checkServerEntry(text(server.contents), {
        path: serverPath,
        ...(manifest === undefined ? {} : { manifest }),
        ...(options.external === undefined ? {} : { external: options.external }),
      }),
      ...sizeIssue("Server entry", byteLength(server.contents), limits.serverBytes, serverPath),
    );
  } else if (manifest === undefined) {
    issues.push(error("missing-file", "Package has no server entry", serverPath));
  }

  let uiBytes = 0;
  let assetsBytes = 0;
  let totalBytes = 0;
  for (const file of files) {
    const size = byteLength(file.contents);
    totalBytes += size;
    if (file.path.startsWith(`${ModulePackage.UiDirectory}/`)) {
      uiBytes += size;
      if (file.path.endsWith(".js")) issues.push(...checkUiChunk(text(file.contents), file.path));
    }
    if (file.path.startsWith(`${ModulePackage.AssetsDirectory}/`)) assetsBytes += size;
  }
  issues.push(
    ...sizeIssue("UI", uiBytes, limits.uiBytes, ModulePackage.UiDirectory),
    ...sizeIssue("Assets", assetsBytes, limits.assetsBytes, ModulePackage.AssetsDirectory),
    ...sizeIssue("Package", totalBytes, limits.totalBytes),
  );
  return { manifest, issues };
};

export * as Checks from "./Checks.ts";
