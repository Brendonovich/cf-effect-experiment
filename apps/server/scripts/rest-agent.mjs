#!/usr/bin/env node
// Simulates a REST API client editing the project, so presence and following can be tried out.
//
//   MACROGRAPH_API_KEY=mg_... pnpm --filter @macrograph/server agent:rest
//
// Environment:
//   MACROGRAPH_API_KEY   API key from the server's settings (required)
//   MACROGRAPH_URL       Server origin, including any base path (default http://localhost:5174)
//   MACROGRAPH_PROJECT   Project ID (default "local")
//   AGENT_INTERVAL_MS    Delay between edits (default 1500)
//   AGENT_NODES          Nodes per graph before moving to a new graph (default 8)
//   AGENT_GRAPHS         Graphs to create before stopping; 0 runs until Ctrl+C (default 0)
//   AGENT_CLEANUP        Set to 1 to delete the graphs it created when it stops

const key = process.env.MACROGRAPH_API_KEY;
if (!key) {
  console.error("Set MACROGRAPH_API_KEY to an API key created in the server's settings.");
  process.exit(1);
}
const origin = (process.env.MACROGRAPH_URL ?? "http://localhost:5174").replace(/\/$/, "");
const project = process.env.MACROGRAPH_PROJECT ?? "local";
const interval = Number(process.env.AGENT_INTERVAL_MS ?? 1500);
const nodesPerGraph = Number(process.env.AGENT_NODES ?? 8);
const maxGraphs = Number(process.env.AGENT_GRAPHS ?? 0);
const cleanup = process.env.AGENT_CLEANUP === "1";

const base = `${origin}/api/projects/${encodeURIComponent(project)}`;
const created = [];
let stopping = false;

const request = async (method, path, body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text === "" ? undefined : JSON.parse(text);
  if (!response.ok) {
    const error = new Error(`${method} ${path} → ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }
  return json;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Nodes without properties can be created without choosing values for them.
const { schemas } = await request("GET", "/schemas?limit=100");
const candidates = schemas.filter((entry) => (entry.schema.properties ?? []).length === 0);
if (candidates.length === 0) {
  console.error("No schemas without properties were found to create nodes from.");
  process.exit(1);
}
const events = candidates.filter((entry) => entry.schema.type === "event");
const steps = candidates.filter((entry) => entry.schema.type !== "event");
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const schemaRef = (entry) => ({ package: entry.package, schema: entry.schema.id });

const stop = async () => {
  if (stopping) return;
  stopping = true;
  if (cleanup) {
    for (const graphId of created) {
      await request("DELETE", `/graphs/${graphId}`).catch((error) =>
        console.warn(`Could not delete ${graphId}: ${error.message}`),
      );
    }
    console.log(`Deleted ${created.length} graph(s).`);
  }
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`Editing ${base} every ${interval}ms. Press Ctrl+C to stop.`);

for (let graphIndex = 1; maxGraphs === 0 || graphIndex <= maxGraphs; graphIndex++) {
  const name = `REST agent ${new Date().toLocaleTimeString()} #${graphIndex}`;
  const { graph } = await request("POST", "/graphs", { name });
  created.push(graph.id);
  console.log(`Created graph "${name}" (${graph.id})`);

  let previous;
  for (let index = 0; index < nodesPerGraph && !stopping; index++) {
    await sleep(interval);
    const entry =
      index === 0 && events.length > 0 ? pick(events) : pick(steps.length > 0 ? steps : candidates);
    // Walk right in a gentle wave so following has to pan.
    const position = { x: index * 260, y: Math.round(Math.sin(index / 1.5) * 180) };
    try {
      const { node, io } = await request("POST", `/graphs/${graph.id}/nodes`, {
        schema: schemaRef(entry),
        position,
      });
      console.log(`  + ${entry.package}/${entry.schema.id} at (${position.x}, ${position.y})`);
      const output = previous?.io.executionOutputs?.[0];
      const input = io.executionInputs?.[0];
      if (previous !== undefined && output !== undefined && input !== undefined) {
        await request("POST", `/graphs/${graph.id}/connections`, {
          outNodeId: previous.node.id,
          outIo: { _tag: "Port", id: output.id },
          inNodeId: node.id,
          inIoId: input.id,
        })
          .then(() => console.log("    connected to previous node"))
          .catch(() => {});
      }
      previous = { node, io };
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        console.error(error.message);
        process.exit(1);
      }
      console.warn(`  ! ${error.message}`);
    }
  }
  await sleep(interval);
}

await stop();
