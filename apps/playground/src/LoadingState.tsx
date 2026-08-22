import type { Component } from "solid-js";

interface LoadingStateProps {
  readonly label: string;
  readonly class?: string;
  readonly compact?: boolean;
}

export const LoadingState: Component<LoadingStateProps> = (props) => (
  <div
    class={`grid place-items-center ${props.class ?? ""}`}
    role="status"
    aria-label={props.label}
  >
    <div class="flex w-full max-w-32 flex-col gap-2">
      <span class="h-2 w-full animate-pulse rounded bg-gray-5" />
      {props.compact ? null : <span class="h-2 w-2/3 animate-pulse rounded bg-gray-4" />}
    </div>
  </div>
);
