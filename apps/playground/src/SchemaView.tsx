import { Schema, SchemaAST } from "effect";
import { For, Match, Switch, type Component } from "solid-js";

type SchemaDescription =
  | { kind: "keyword"; value: string }
  | { kind: "literal"; value: unknown }
  | { kind: "struct"; fields: Array<[string, SchemaDescription]> }
  | { kind: "union"; variants: SchemaDescription[] }
  | { kind: "array"; element: SchemaDescription }
  | { kind: "tuple"; elements: SchemaDescription[] }
  | { kind: "record"; value: SchemaDescription }
  | { kind: "lazy" }
  | { kind: "unknown" };

function describeSchema(schema: Schema.Top): SchemaDescription {
  return describeAST(schema.ast);
}

function describeAST(ast: SchemaAST.AST): SchemaDescription {
  if (SchemaAST.isString(ast)) return { kind: "keyword", value: "string" };
  if (SchemaAST.isNumber(ast)) return { kind: "keyword", value: "number" };
  if (SchemaAST.isBoolean(ast)) return { kind: "keyword", value: "boolean" };
  if (SchemaAST.isVoid(ast)) return { kind: "keyword", value: "void" };
  if (SchemaAST.isNever(ast)) return { kind: "keyword", value: "never" };
  if (SchemaAST.isAny(ast)) return { kind: "keyword", value: "any" };
  if (SchemaAST.isUnknown(ast)) return { kind: "keyword", value: "unknown" };
  if (SchemaAST.isUndefined(ast)) return { kind: "keyword", value: "undefined" };
  if (SchemaAST.isNull(ast)) return { kind: "keyword", value: "null" };
  if (SchemaAST.isBigInt(ast)) return { kind: "keyword", value: "bigint" };
  if (SchemaAST.isSymbol(ast)) return { kind: "keyword", value: "symbol" };
  if (SchemaAST.isLiteral(ast)) return { kind: "literal", value: ast.literal };

  if (SchemaAST.isObjects(ast)) {
    if (ast.propertySignatures.length === 0 && ast.indexSignatures.length > 0) {
      return { kind: "record", value: describeAST(ast.indexSignatures[0]!.type) };
    }
    const fields: Array<[string, SchemaDescription]> = ast.propertySignatures.map((ps) => [
      ps.name as string,
      describeAST(ps.type),
    ]);
    return { kind: "struct", fields };
  }

  if (SchemaAST.isUnion(ast)) {
    return { kind: "union", variants: ast.types.map(describeAST) };
  }

  if (SchemaAST.isArrays(ast)) {
    if (ast.elements.length > 0) {
      const elements = ast.elements.map((t) => describeAST(t));
      const rest = ast.rest.map((t) => describeAST(t));
      return { kind: "tuple", elements: [...elements, ...rest] };
    }
    if (ast.rest.length === 1) {
      return { kind: "array", element: describeAST(ast.rest[0]!) };
    }
    return { kind: "array", element: { kind: "unknown" } };
  }

  if (SchemaAST.isSuspend(ast)) {
    return { kind: "lazy" };
  }

  if (SchemaAST.isEnum(ast)) {
    return {
      kind: "union",
      variants: ast.enums.map((e) => ({ kind: "literal" as const, value: e })),
    };
  }

  if (SchemaAST.isTemplateLiteral(ast)) {
    return { kind: "keyword", value: "string" };
  }

  if (SchemaAST.isDeclaration(ast)) {
    const brands = (ast.annotations as any)?.brands as Array<string> | undefined;
    if (brands && brands.length > 0) {
      return { kind: "keyword", value: brands[brands.length - 1]! };
    }
    const id = SchemaAST.resolveIdentifier(ast);
    if (id) return { kind: "keyword", value: id };
    return { kind: "keyword", value: "unknown" };
  }

  if (SchemaAST.isUniqueSymbol(ast)) return { kind: "keyword", value: "symbol" };
  if (SchemaAST.isObjectKeyword(ast)) return { kind: "keyword", value: "object" };

  return { kind: "unknown" };
}

function formatLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

const KeywordClass: Record<string, string> = {
  string: "text-blue-600",
  number: "text-orange-600",
  boolean: "text-purple-600",
  void: "text-gray-400",
  never: "text-red-400",
  any: "text-yellow-600",
  unknown: "text-gray-500",
  undefined: "text-gray-400",
  null: "text-gray-400",
  bigint: "text-orange-600",
};

export const SchemaView: Component<{ schema: Schema.Top }> = (props) => {
  const desc = () => describeSchema(props.schema);
  return <SchemaNode desc={desc()} />;
};

const SchemaNode: Component<{ desc: SchemaDescription }> = (props) => {
  return (
    <Switch>
      <Match when={props.desc.kind === "keyword"}>
        <span class={KeywordClass[(props.desc as any).value] ?? "text-gray-700"}>
          {(props.desc as any).value}
        </span>
      </Match>

      <Match when={props.desc.kind === "literal"}>
        <span class="text-green-600">{formatLiteral((props.desc as any).value)}</span>
      </Match>

      <Match when={props.desc.kind === "struct"}>
        <span class="text-gray-500">{"{ "}</span>
        <For each={(props.desc as any).fields}>
          {([name, type]: [string, SchemaDescription], i) => (
            <span>
              {i() > 0 && <span class="text-gray-400">{", "}</span>}
              <span class="text-cyan-700">{name}</span>
              <span class="text-gray-500">: </span>
              <SchemaNode desc={type} />
            </span>
          )}
        </For>
        <span class="text-gray-500">{" }"}</span>
      </Match>

      <Match when={props.desc.kind === "union"}>
        <For each={(props.desc as any).variants}>
          {(variant: SchemaDescription, i) => (
            <span>
              {i() > 0 && <span class="text-gray-400">{" | "}</span>}
              <SchemaNode desc={variant} />
            </span>
          )}
        </For>
      </Match>

      <Match when={props.desc.kind === "array"}>
        <span class="text-gray-500">{"Array<"}</span>
        <SchemaNode desc={(props.desc as any).element} />
        <span class="text-gray-500">{">"}</span>
      </Match>

      <Match when={props.desc.kind === "tuple"}>
        <span class="text-gray-500">{"["}</span>
        <For each={(props.desc as any).elements}>
          {(element: SchemaDescription, i) => (
            <span>
              {i() > 0 && <span class="text-gray-400">{", "}</span>}
              <SchemaNode desc={element} />
            </span>
          )}
        </For>
        <span class="text-gray-500">{"]"}</span>
      </Match>

      <Match when={props.desc.kind === "record"}>
        <span class="text-gray-500">{"Record<string, "}</span>
        <SchemaNode desc={(props.desc as any).value} />
        <span class="text-gray-500">{">"}</span>
      </Match>

      <Match when={props.desc.kind === "lazy"}>
        <span class="text-gray-400 italic">{"..."}</span>
      </Match>

      <Match when={props.desc.kind === "unknown"}>
        <span class="text-gray-400">{"?"}</span>
      </Match>
    </Switch>
  );
};
