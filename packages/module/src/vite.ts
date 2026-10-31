import type { Plugin } from "vite";

import { parse } from "@babel/parser";
import MagicString from "magic-string";

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
