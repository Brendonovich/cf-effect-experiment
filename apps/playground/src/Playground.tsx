import { Rpc, RpcSchema } from "effect/unstable/rpc";
import { For, Show, type Component } from "solid-js";

import { RpcMethod } from "./RpcMethod";

interface PlaygroundProps {
	group: { readonly requests: ReadonlyMap<string, Rpc.Any> };
	url?: string;
	wsUrl?: string;
}

export const Playground: Component<PlaygroundProps> = (props) => {
	const endpoint = () => props.wsUrl ?? props.url ?? "";

	const entries = () =>
		Array.from(props.group.requests.entries()).sort(([a], [b]) => a.localeCompare(b)) as Array<
			[string, Rpc.AnyWithProps]
		>;

	const unary = () => entries().filter(([, rpc]) => !RpcSchema.isStreamSchema(rpc.successSchema));
	const streaming = () =>
		entries().filter(([, rpc]) => RpcSchema.isStreamSchema(rpc.successSchema));

	return (
		<div class="min-h-screen bg-white">
			<header class="border-b border-gray-200 bg-gray-50">
				<div class="max-w-4xl mx-auto px-4 py-4">
					<h1 class="text-xl font-bold text-gray-900">Effect RPC Playground</h1>
					<p class="text-sm text-gray-500 mt-0.5">
						Endpoint: <code class="text-gray-700">{endpoint()}</code>
						<Show when={props.wsUrl}>
							<span class="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
								WebSocket
							</span>
						</Show>
					</p>
				</div>
			</header>

			<main class="max-w-4xl mx-auto px-4 py-6 space-y-8">
				<section>
					<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
						Unary RPCs
					</h2>
					<div class="space-y-2">
						<For each={unary()}>
							{([tag, rpc]) => (
								<RpcMethod
									tag={tag}
									rpc={rpc}
									group={props.group}
									{...(props.url ? { url: props.url } : {})}
									{...(props.wsUrl ? { wsUrl: props.wsUrl } : {})}
								/>
							)}
						</For>
					</div>
				</section>

				<Show when={streaming().length > 0}>
					<section>
						<h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
							Streaming RPCs
						</h2>
						<div class="space-y-2">
							<For each={streaming()}>
								{([tag, rpc]) => (
									<RpcMethod
										tag={tag}
										rpc={rpc}
										group={props.group}
										{...(props.url ? { url: props.url } : {})}
										{...(props.wsUrl ? { wsUrl: props.wsUrl } : {})}
									/>
								)}
							</For>
						</div>
					</section>
				</Show>
			</main>
		</div>
	);
};
