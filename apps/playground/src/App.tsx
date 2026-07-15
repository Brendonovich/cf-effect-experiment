import { EditorRpc } from "@macrograph/editor";

import { Playground } from "./Playground";

export function App() {
  return <Playground group={EditorRpc.EditorRpcs} wsUrl={`${location.origin}/rpc`} />;
}
