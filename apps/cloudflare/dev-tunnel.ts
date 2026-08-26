import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const vitePort = 5175;
console.log(`Local app: http://localhost:${vitePort}`);

const tunnel = spawn(
  "cloudflared",
  ["tunnel", "--url", "http://localhost:1338", "--no-autoupdate"],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let vite: ReturnType<typeof spawn> | undefined;
const findTunnelUrl = async (stream: NodeJS.ReadableStream, output: NodeJS.WriteStream) => {
  for await (const line of createInterface({ input: stream })) {
    output.write(`${line}\n`);
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match !== null) return match[0];
  }
  throw new Error("cloudflared exited before publishing a tunnel URL");
};

const stop = () => {
  tunnel.kill();
  vite?.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const tunnelUrl = await Promise.any([
  findTunnelUrl(tunnel.stdout, process.stdout),
  findTunnelUrl(tunnel.stderr, process.stderr),
]);
await mkdir(".alchemy", { recursive: true });
await writeFile(".alchemy/dev-tunnel-url", tunnelUrl);
console.log(`Public ingress: ${tunnelUrl}`);

const reconcileIngress = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch("http://localhost:1338/__macrograph/reconcile-ingress", {
        method: "POST",
        headers: { "x-macrograph-public-origin": tunnelUrl },
      });
      if (!response.ok) throw new Error(`Ingress reconciliation failed: ${response.status}`);
      const result: unknown = await response.json();
      console.log("Reconciled deployed ingress for public ingress worker", result);
      return;
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
};

void reconcileIngress().catch((error) => {
  console.error("Failed to reconcile deployed ingress", error);
});

vite = spawn(
  "pnpm",
  ["exec", "vite", "--host", "0.0.0.0", "--port", String(vitePort), "--strictPort"],
  {
    cwd: "frontend",
    env: {
      ...process.env,
      ...(process.env.AXIOM_ORG_ID === undefined
        ? {}
        : { VITE_AXIOM_ORG_ID: process.env.AXIOM_ORG_ID }),
      VITE_AXIOM_TRACE_DATASET: "macrograph-traces",
      VITE_WORKER_URL: "http://localhost:1337",
      VITE_PUBLIC_WORKER_ORIGIN: `http://localhost:${vitePort}`,
      VITE_PUBLIC_INGRESS_ORIGIN: tunnelUrl,
    },
    stdio: "inherit",
  },
);

await Promise.race([once(tunnel, "exit"), once(vite, "exit")]);
stop();
