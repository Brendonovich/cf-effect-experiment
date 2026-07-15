import { Package } from "@macrograph/core";
import { Effect, Fiber, Schema, SchemaAST, Stream } from "effect";
import { Rpc, RpcSchema } from "effect/unstable/rpc";
import { onCleanup, createSignal, type Component, Show, For } from "solid-js";

import { SchemaView } from "./SchemaView";

interface MethodProps {
  tag: string;
  rpc: Rpc.AnyWithProps;
  client: any;
  packages: Package.Model[];
}

export const RpcMethod: Component<MethodProps> = (props) => {
  const packages = () => props.packages;

  const [expanded, setExpanded] = createSignal(false);
  const [payloadText, setPayloadText] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [result, setResult] = createSignal<{
    type: "success" | "error";
    value: unknown;
  } | null>(null);
  const [errorText, setErrorText] = createSignal<string | null>(null);

  const [subscribed, setSubscribed] = createSignal(false);
  const [events, setEvents] = createSignal<any[]>([]);
  let fiber: Fiber.Fiber<any, any> | null = null;

  // Autocomplete state
  const [showAutocomplete, setShowAutocomplete] = createSignal(false);
  const [autocompleteOptions, setAutocompleteOptions] = createSignal<
    { label: string; value: string }[]
  >([]);
  const [autocompleteTarget, setAutocompleteTarget] = createSignal<{
    start: number;
    end: number;
  } | null>(null);
  let textareaRef: HTMLTextAreaElement | null = null;

  onCleanup(() => {
    if (fiber) {
      Effect.runFork(Fiber.interrupt(fiber));
    }
  });

  const isStreaming = () => RpcSchema.isStreamSchema(props.rpc.successSchema);

  const hasPayload = () => !SchemaAST.isVoid(props.rpc.payloadSchema.ast);

  const successIsVoid = () => SchemaAST.isVoid(props.rpc.successSchema.ast);
  const errorIsNever = () => SchemaAST.isNever(props.rpc.errorSchema.ast);

  const generateTemplate = () => {
    try {
      const template = generateJsonTemplate(props.rpc.payloadSchema.ast);
      setPayloadText(JSON.stringify(template, null, 2));
    } catch {
      setPayloadText("{}");
    }
  };

  if (hasPayload()) {
    generateTemplate();
  }

  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const text = payloadText();
    const cursor = e.currentTarget.selectionStart;
    const beforeCursor = text.slice(0, cursor);
    const pkgs = packages();

    // Check if we're inside a schema.package string value
    const packageMatch = beforeCursor.match(/("package"\s*:\s*")([^"]*)$/);
    if (packageMatch && packageMatch.length >= 3 && pkgs.length > 0) {
      const partial = packageMatch[2]!.toLowerCase();
      const options = pkgs
        .filter(
          (p) => p.id.toLowerCase().includes(partial) || p.name.toLowerCase().includes(partial),
        )
        .map((p) => ({ label: `${p.name} (${p.id})`, value: p.id }));
      if (options.length > 0) {
        setAutocompleteOptions(options);
        setAutocompleteTarget({
          start: packageMatch.index! + packageMatch[1]!.length,
          end: cursor,
        });
        setShowAutocomplete(true);
        return;
      }
    }

    // Check if we're inside a schema.schema string value
    const schemaMatch = beforeCursor.match(/("schema"\s*:\s*")([^"]*)$/);
    if (schemaMatch && schemaMatch.length >= 3 && pkgs.length > 0) {
      const partial = schemaMatch[2]!.toLowerCase();
      const options = pkgs.flatMap((p) =>
        p.schemas
          .filter(
            (s) => s.id.toLowerCase().includes(partial) || s.name.toLowerCase().includes(partial),
          )
          .map((s) => ({
            label: `${p.name} › ${s.name} (${s.id})`,
            value: s.id,
          })),
      );
      if (options.length > 0) {
        setAutocompleteOptions(options);
        setAutocompleteTarget({
          start: schemaMatch.index! + schemaMatch[1]!.length,
          end: cursor,
        });
        setShowAutocomplete(true);
        return;
      }
    }

    setShowAutocomplete(false);
  };

  const selectOption = (value: string) => {
    const target = autocompleteTarget();
    if (!target) return;
    const text = payloadText();
    const newText = text.slice(0, target.start) + value + text.slice(target.end);
    setPayloadText(newText);
    setShowAutocomplete(false);

    // Restore focus and cursor
    requestAnimationFrame(() => {
      if (textareaRef) {
        textareaRef.focus();
        const newCursor = target.start + value.length;
        textareaRef.setSelectionRange(newCursor, newCursor);
      }
    });
  };

  const send = async () => {
    setSending(true);
    setResult(null);
    setErrorText(null);

    try {
      let decodedPayload: any = undefined;
      if (hasPayload()) {
        const parsed = JSON.parse(payloadText());
        const codec = Schema.toCodecJson(props.rpc.payloadSchema);
        decodedPayload = Schema.decodeUnknownSync(codec as any)(parsed);
      }

      const callResult = await Effect.runPromise(
        (props.client as any)[props.tag](decodedPayload),
      ).then(
        (value) => ({ type: "success" as const, value }),
        (error: unknown) => ({ type: "error" as const, value: error }),
      );

      let displayValue: unknown = callResult.value;
      if (callResult.type === "success" && !successIsVoid()) {
        try {
          const codec = Schema.toCodecJson(props.rpc.successSchema);
          displayValue = Schema.encodeSync(codec as any)(callResult.value);
        } catch {
          displayValue = callResult.value;
        }
      } else if (callResult.type === "error" && !errorIsNever()) {
        try {
          const codec = Schema.toCodecJson(props.rpc.errorSchema);
          displayValue = Schema.encodeSync(codec as any)(callResult.value);
        } catch {
          displayValue = callResult.value;
        }
      }

      setResult({ type: callResult.type, value: displayValue });
    } catch (err: any) {
      setErrorText(err?.message ?? String(err));
    } finally {
      setSending(false);
    }
  };

  const subscribe = () => {
    setSubscribed(true);
    setEvents([]);
    setErrorText(null);

    try {
      let decodedPayload: any = undefined;
      if (hasPayload()) {
        const parsed = JSON.parse(payloadText());
        const codec = Schema.toCodecJson(props.rpc.payloadSchema);
        decodedPayload = Schema.decodeUnknownSync(codec as any)(parsed);
      }

      const stream = (props.client as any)[props.tag](decodedPayload);

      fiber = Effect.runFork(
        stream.pipe(
          Stream.runForEach((event: any) =>
            Effect.sync(() => {
              setEvents((prev) => [...prev, event]);
            }),
          ),
          Effect.tapError(Effect.log),
          Effect.tapDefect(Effect.log),
        ),
      );
    } catch (err: any) {
      setErrorText(err?.message ?? String(err));
    }
  };

  const stop = () => {
    if (fiber) {
      Effect.runFork(Fiber.interrupt(fiber));
      fiber = null;
    }
    setSubscribed(false);
  };

  const eventSchema = () => {
    if (!RpcSchema.isStreamSchema(props.rpc.successSchema)) return null;
    return props.rpc.successSchema.success;
  };

  return (
    <div class="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded())}
        class="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
      >
        <span class="text-gray-400 font-mono text-sm">{expanded() ? "▼" : "▶"}</span>
        <span class="font-mono font-semibold text-gray-900">{props.rpc._tag}</span>
        <Show when={isStreaming()}>
          <span class="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
            Stream
          </span>
        </Show>
      </button>

      <Show when={expanded()}>
        <div class="border-t border-gray-200">
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 px-4 py-3 text-sm">
            <span class="text-gray-500 font-medium">Payload</span>
            <div>
              <Show when={hasPayload()} fallback={<span class="text-gray-400">void</span>}>
                <SchemaView schema={props.rpc.payloadSchema} />
              </Show>
            </div>

            <Show when={isStreaming()}>
              <span class="text-gray-500 font-medium">Events</span>
              <div>
                <Show when={eventSchema()}>{(schema) => <SchemaView schema={schema()} />}</Show>
              </div>
            </Show>

            <Show when={!isStreaming()}>
              <span class="text-gray-500 font-medium">Response</span>
              <div>
                <Show when={!successIsVoid()} fallback={<span class="text-gray-400">void</span>}>
                  <SchemaView schema={props.rpc.successSchema} />
                </Show>
              </div>
            </Show>

            <Show when={!errorIsNever()}>
              <span class="text-gray-500 font-medium">Errors</span>
              <div>
                <SchemaView schema={props.rpc.errorSchema} />
              </div>
            </Show>
          </div>

          <div class="border-t border-gray-200 px-4 py-3 space-y-3">
            <button
              onClick={generateTemplate}
              class="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
            >
              Fill template
            </button>

            <Show when={hasPayload()}>
              <div class="relative">
                <textarea
                  ref={(el) => (textareaRef = el)}
                  value={payloadText()}
                  onInput={handleInput}
                  rows={6}
                  class="mt-2 w-full font-mono text-xs border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  placeholder='{ "key": "value" }'
                />
                <Show when={showAutocomplete()}>
                  <div class="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-40 overflow-y-auto">
                    <For each={autocompleteOptions()}>
                      {(opt) => (
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectOption(opt.value);
                          }}
                          class="block w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 text-gray-700"
                        >
                          {opt.label}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>

            <div class="flex items-center gap-3">
              <Show
                when={!isStreaming()}
                fallback={
                  <Show
                    when={!subscribed()}
                    fallback={
                      <button
                        onClick={stop}
                        class="px-4 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                      >
                        Stop
                      </button>
                    }
                  >
                    <button
                      onClick={subscribe}
                      disabled={subscribed()}
                      class="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 rounded-lg transition-colors"
                    >
                      {subscribed() ? "Connecting..." : "Subscribe"}
                    </button>
                  </Show>
                }
              >
                <button
                  onClick={send}
                  disabled={sending()}
                  class="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg transition-colors"
                >
                  {sending() ? "Sending..." : "Send"}
                </button>
              </Show>

              <Show when={result()}>
                <span
                  class={`text-xs px-2 py-0.5 rounded ${
                    result()!.type === "success"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {result()!.type === "success" ? "Success" : "Error"}
                </span>
              </Show>

              <Show when={events().length > 0}>
                <span class="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                  {events().length} event{events().length !== 1 ? "s" : ""}
                </span>
              </Show>
            </div>

            <Show when={events().length > 0}>
              <div class="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
                <For each={events()}>
                  {(event, i) => (
                    <div class="px-3 py-2">
                      <span class="text-xs text-gray-400 font-mono mr-2">#{i() + 1}</span>
                      <pre class="inline text-xs font-mono text-gray-800">
                        {JSON.stringify(event, null, 2)}
                      </pre>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={result()}>
              <pre class="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono overflow-x-auto">
                {JSON.stringify(result()!.value, null, 2)}
              </pre>
            </Show>

            <Show when={errorText()}>
              <pre class="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-mono text-red-700 overflow-x-auto">
                {errorText()}
              </pre>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

function generateJsonTemplate(ast: SchemaAST.AST): unknown {
  if (SchemaAST.isString(ast)) return "";
  if (SchemaAST.isNumber(ast)) return 0;
  if (SchemaAST.isBoolean(ast)) return false;
  if (SchemaAST.isVoid(ast)) return null;
  if (SchemaAST.isAny(ast) || SchemaAST.isUnknown(ast)) return null;
  if (SchemaAST.isUndefined(ast)) return undefined;
  if (SchemaAST.isNull(ast)) return null;
  if (SchemaAST.isLiteral(ast)) return ast.literal;

  if (SchemaAST.isObjects(ast)) {
    const result: Record<string, unknown> = {};
    for (const ps of ast.propertySignatures) {
      result[ps.name as string] = generateJsonTemplate(ps.type);
    }
    return result;
  }

  if (SchemaAST.isUnion(ast)) {
    return generateJsonTemplate(ast.types[0]!);
  }

  if (SchemaAST.isArrays(ast)) {
    if (ast.elements.length > 0) {
      return ast.elements.map((t) => generateJsonTemplate(t));
    }
    return [];
  }

  if (SchemaAST.isSuspend(ast)) return null;
  if (SchemaAST.isEnum(ast)) return ast.enums[0] ?? "";
  if (SchemaAST.isTemplateLiteral(ast)) return "";
  if (SchemaAST.isNull(ast)) return null;
  if (SchemaAST.isDeclaration(ast)) {
    if (ast.typeParameters.length > 0) {
      return generateJsonTemplate(ast.typeParameters[0]!);
    }
    return null;
  }

  return null;
}
