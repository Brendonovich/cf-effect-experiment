import { initializeBrowserTracing } from "@macrograph/editor-ui";
import { render } from "@solidjs/web";

import { App } from "./App";
import "./index.css";

document.documentElement.classList.add("dark", "dark-theme");

const root = document.getElementById("root");
const bootstrap = async () => {
  if (root === null) return;
  await initializeBrowserTracing(import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT);
  render(() => <App />, root);
};

void bootstrap();
