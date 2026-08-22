import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { createInterface } from "node:readline";

const isListening = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection({ port, host });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(100, () => finish(false));
  });

const findAvailablePort = async (start: number) => {
  for (let port = start; port <= 65_535; port++) {
    const loopbackInUse = await Promise.all([
      isListening(port, "127.0.0.1"),
      isListening(port, "::1"),
    ]);
    if (loopbackInUse.some(Boolean)) continue;

    const server = createServer();
    const available = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, "0.0.0.0");
    });
    if (available) return port;
  }
  throw new Error(`No available port found starting at ${start}`);
};

const vitePort = await findAvailablePort(5173);
console.log(`Local app: http://localhost:${vitePort}`);

const tunnel = spawn(
  "cloudflared",
  ["tunnel", "--url", "http://localhost:1337", "--no-autoupdate"],
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
await writeFile(".alchemy/dev-tunnel-url", tunnelUrl);
console.log(`Public runtime: ${tunnelUrl}`);

vite = spawn(
  "pnpm",
  ["exec", "vite", "--host", "0.0.0.0", "--port", String(vitePort), "--strictPort"],
  {
    cwd: "../playground",
    env: {
      ...process.env,
      VITE_WORKER_URL: "http://localhost:1337",
      VITE_PUBLIC_RUNTIME_ORIGIN: tunnelUrl,
    },
    stdio: "inherit",
  },
);

await Promise.race([once(tunnel, "exit"), once(vite, "exit")]);
stop();
