import { EditorRpc } from "@macrograph/editor";

import { Playground } from "./Playground";

export function App() {
	return (
		<Playground
			group={EditorRpc.EditorRpcs}
			url="http://localhost:1337/rpc"
			wsUrl="ws://localhost:1337/rpc-ws"
		// wsUrl="ws://cloudflare-mainworker-dev-brendonovich5egibymynq36yh4t.brendonovich.workers.dev/rpc-ws"
		/>
	);
}
