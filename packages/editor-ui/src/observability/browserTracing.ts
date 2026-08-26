import { WebSdk } from "@effect/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Effect, ManagedRuntime } from "effect";

export const parseOtlpEndpoint = (value: string | undefined): string | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
};

export const sanitizeNavigationPath = (value: string): string => {
  const segments = value.split("/");
  return segments
    .map((segment, index) => {
      const previous = segments[index - 1];
      if (
        previous === "teams" ||
        previous === "projects" ||
        previous === "deployments" ||
        previous === "events" ||
        segments[index - 2] === "editor"
      )
        return ":id";
      return segment.length > 48 ? ":id" : segment;
    })
    .join("/");
};

let runForkImpl: typeof Effect.runFork = Effect.runFork;
let runPromiseImpl: typeof Effect.runPromise = Effect.runPromise;

interface BrowserTracingState {
  readonly runFork: typeof Effect.runFork;
  readonly runPromise: typeof Effect.runPromise;
  readonly traceInitialNavigation: () => void;
  readonly dispose: () => Promise<void>;
}

declare global {
  interface Window {
    __macrographBrowserTracing?: Promise<BrowserTracingState | undefined>;
  }
}

export const runFork: typeof Effect.runFork = (effect, options) => runForkImpl(effect, options);
export const runPromise: typeof Effect.runPromise = (effect, options) =>
  runPromiseImpl(effect, options);

export const traceNavigation = (path: string) =>
  runFork(
    Effect.void.pipe(
      Effect.withSpan("browser.navigation", {
        attributes: { "navigation.path": sanitizeNavigationPath(path) },
      }),
    ),
  );

export const initializeBrowserTracing = async (configuredEndpoint: string | undefined) => {
  const endpoint = parseOtlpEndpoint(configuredEndpoint);
  if (endpoint === undefined || typeof window === "undefined") return;

  window.__macrographBrowserTracing ??= (async () => {
    const processor = new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }), {
      maxQueueSize: 256,
      maxExportBatchSize: 64,
      scheduledDelayMillis: 5_000,
      exportTimeoutMillis: 10_000,
    });
    const runtime = ManagedRuntime.make(
      WebSdk.layer(() => ({
        resource: { serviceName: "macrograph-browser" },
        spanProcessor: processor,
      })),
    );
    try {
      await runtime.runPromise(Effect.void);
    } catch {
      await runtime.dispose();
      delete window.__macrographBrowserTracing;
      return undefined;
    }

    const flush = () => void processor.forceFlush().catch(() => undefined);
    const onPopState = () => traceNavigation(location.pathname);
    const pushState = history.pushState.bind(history);
    const replaceState = history.replaceState.bind(history);
    const tracedPushState: History["pushState"] = (...args) => {
      pushState(...args);
      traceNavigation(location.pathname);
    };
    const tracedReplaceState: History["replaceState"] = (...args) => {
      replaceState(...args);
      traceNavigation(location.pathname);
    };
    history.pushState = tracedPushState;
    history.replaceState = tracedReplaceState;
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("popstate", onPopState);
    let tracedInitialNavigation = false;

    return {
      runFork: runtime.runFork,
      runPromise: runtime.runPromise,
      traceInitialNavigation: () => {
        if (tracedInitialNavigation) return;
        tracedInitialNavigation = true;
        traceNavigation(location.pathname);
      },
      dispose: async () => {
        window.removeEventListener("pagehide", flush);
        window.removeEventListener("beforeunload", flush);
        window.removeEventListener("popstate", onPopState);
        if (history.pushState === tracedPushState) history.pushState = pushState;
        if (history.replaceState === tracedReplaceState) history.replaceState = replaceState;
        await runtime.dispose();
      },
    };
  })();

  const state = await window.__macrographBrowserTracing;
  if (state === undefined) return;
  runForkImpl = state.runFork;
  runPromiseImpl = state.runPromise;
  state.traceInitialNavigation();
};

import.meta.hot?.dispose(() => {
  const setup = window.__macrographBrowserTracing;
  delete window.__macrographBrowserTracing;
  runForkImpl = Effect.runFork;
  runPromiseImpl = Effect.runPromise;
  void setup?.then((state) => state?.dispose());
});
