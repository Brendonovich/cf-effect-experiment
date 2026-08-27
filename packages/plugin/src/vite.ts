import type { Plugin } from "vite";

import { parse } from "@babel/parser";
import MagicString from "magic-string";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface PluginPackage {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly macrograph?: Readonly<Record<string, unknown>>;
}

interface DiscoveryOptions {
  readonly name: string;
  readonly virtualId: string;
  readonly workspaceRoot?: string;
  readonly exportName: string;
  readonly modulePath: (manifest: PluginPackage) => string | undefined;
  readonly filter?: string;
  readonly include?: ReadonlySet<string>;
}

interface ModuleGraph<Module> {
  readonly getModuleById: (id: string) => Module | undefined;
  readonly invalidateModule: (module: Module) => void;
}

const exportPath = (manifest: PluginPackage, name: string) => {
  const value = manifest.exports?.[name];
  return typeof value === "string" ? value : undefined;
};

const manifestPath = (manifest: PluginPackage, name: string) => {
  const value = manifest.macrograph?.[name];
  return typeof value === "string" ? value : undefined;
};

const workspaceModules = (options: DiscoveryOptions) => {
  const workspaceRoot = options.workspaceRoot ?? resolve(import.meta.dirname, "../../..");
  const pluginsDirectory = resolve(workspaceRoot, "packages/plugins");
  const resolvedVirtualId = `\0${options.virtualId}`;
  const discover = () =>
    readdirSync(pluginsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const packageJson = resolve(pluginsDirectory, entry.name, "package.json");
        if (!existsSync(packageJson)) return [];
        const manifest = JSON.parse(readFileSync(packageJson, "utf8")) as PluginPackage;
        if (options.include !== undefined && !options.include.has(manifest.name ?? entry.name))
          return [];
        const modulePath = options.modulePath(manifest);
        return modulePath === undefined
          ? []
          : [
              {
                packageJson,
                source: manifest.name ?? entry.name,
                modulePath: resolve(pluginsDirectory, entry.name, modulePath),
              },
            ];
      })
      .sort((left, right) => left.source.localeCompare(right.source));
  const invalidate = <Module>(moduleGraph: ModuleGraph<Module>) => {
    const module = moduleGraph.getModuleById(resolvedVirtualId);
    if (module !== undefined) moduleGraph.invalidateModule(module);
    return module;
  };

  return {
    name: options.name,
    resolveId(id: string) {
      return id === options.virtualId ? resolvedVirtualId : undefined;
    },
    buildStart(this: { addWatchFile: (path: string) => void }) {
      this.addWatchFile(pluginsDirectory);
      for (const module of discover()) {
        this.addWatchFile(module.packageJson);
        this.addWatchFile(module.modulePath);
      }
    },
    configureServer<Module>(server: {
      readonly watcher: { add: (path: string) => void };
      readonly moduleGraph: ModuleGraph<Module>;
    }) {
      server.watcher.add(pluginsDirectory);
      for (const module of discover()) {
        server.watcher.add(module.packageJson);
        server.watcher.add(module.modulePath);
      }
      const refresh = () => invalidate(server.moduleGraph);
      server.watcher.add(resolve(pluginsDirectory, "*/package.json"));
      return refresh;
    },
    handleHotUpdate<Module>(context: {
      readonly file: string;
      readonly server: { moduleGraph: ModuleGraph<Module> };
    }) {
      if (!context.file.startsWith(`${pluginsDirectory}/`)) return;
      const module = invalidate(context.server.moduleGraph);
      return module === undefined ? [] : [module];
    },
    load(id: string) {
      if (id !== resolvedVirtualId) return undefined;
      const modules = discover();
      const imports = modules
        .map(
          (module, index) =>
            `import { ${options.exportName} as value${index} } from ${JSON.stringify(module.modulePath)};`,
        )
        .join("\n");
      const values = modules
        .map(
          (module, index) => `{ value: value${index}, source: ${JSON.stringify(module.source)} }`,
        )
        .join(", ");
      const filter =
        options.filter === undefined ? "" : `.filter(({ value }) => ${options.filter})`;
      return `${imports}\nconst discovered = [${values}]${filter};\nconst ids = new Map();\nfor (const entry of discovered) {\n  const id = entry.value.pluginId ?? entry.value.id;\n  const previous = ids.get(id);\n  if (previous !== undefined) throw new Error(\`Duplicate plugin id \${id}: \${previous}, \${entry.source}\`);\n  ids.set(id, entry.source);\n}\nexport default discovered.map((entry) => entry.value);`;
    },
  } satisfies Plugin;
};

export const stylexProps = () =>
  ({
    name: "macrograph-stylex-props",
    enforce: "pre",
    transform(source, id) {
      if (!/\.[jt]sx(?:\?|$)/.test(id) || !/\bsx\s*=/.test(source)) return;

      const ast = parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] });
      const namespace = ast.program.body
        .flatMap((statement) =>
          statement.type === "ImportDeclaration" && statement.source.value === "@stylexjs/stylex"
            ? statement.specifiers
            : [],
        )
        .find((specifier) => specifier.type === "ImportNamespaceSpecifier")?.local.name;
      const runtime = namespace ?? "__macrographStylex";
      const output = new MagicString(source);
      let transformed = false;

      const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
          for (const child of value) visit(child);
          return;
        }
        if (typeof value !== "object" || value === null) return;

        const node = value as Record<string, unknown>;
        if (node.type === "JSXOpeningElement") {
          const name = node.name as Record<string, unknown> | undefined;
          if (name?.type === "JSXIdentifier" && /^[a-z]/.test(String(name.name))) {
            for (const candidate of node.attributes as unknown[]) {
              const attribute = candidate as Record<string, unknown>;
              const attributeName = attribute.name as Record<string, unknown> | undefined;
              const attributeValue = attribute.value as Record<string, unknown> | undefined;
              if (
                attribute.type !== "JSXAttribute" ||
                attributeName?.type !== "JSXIdentifier" ||
                attributeName.name !== "sx" ||
                attributeValue?.type !== "JSXExpressionContainer"
              )
                continue;

              const expression = attributeValue.expression as Record<string, unknown>;
              if (expression.type === "JSXEmptyExpression") continue;
              output.overwrite(
                Number(attribute.start),
                Number(attribute.end),
                `{...${runtime}.attrs(${source.slice(Number(expression.start), Number(expression.end))})}`,
              );
              transformed = true;
            }
          }
        }

        for (const child of Object.values(node)) visit(child);
      };

      visit(ast.program);
      if (!transformed) return;
      if (namespace === undefined)
        output.prepend(`import * as ${runtime} from "@stylexjs/stylex";\n`);
      return { code: output.toString(), map: output.generateMap({ hires: true, source: id }) };
    },
  }) satisfies Plugin;

export const pluginSettings = (workspaceRoot?: string, include?: ReadonlySet<string>) =>
  workspaceModules({
    name: "macrograph-plugin-settings",
    virtualId: "virtual:macrograph-plugin-settings",
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    exportName: "settings",
    modulePath: (manifest) => exportPath(manifest, "./Settings"),
    ...(include === undefined ? {} : { include }),
  });

/** Discovers standalone engine deployments and engine-less plugin exports. */
export const pluginDeployments = (workspaceRoot?: string, include?: ReadonlySet<string>) =>
  workspaceModules({
    name: "macrograph-plugin-deployments",
    virtualId: "virtual:macrograph-plugin-deployments",
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    exportName: "default",
    modulePath: (manifest) =>
      manifestPath(manifest, "standaloneDeployment") ?? exportPath(manifest, "."),
    filter: '"definition" in value || value.engine === undefined',
    ...(include === undefined ? {} : { include }),
  });
