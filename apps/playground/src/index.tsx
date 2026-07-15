/* @refresh reload */
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";

import "./index.css";
import { App } from "./App";

const queryClient = new QueryClient();

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    ),
    root,
  );
}
