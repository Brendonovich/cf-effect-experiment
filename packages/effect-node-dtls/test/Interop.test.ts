import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Layer, Result } from "effect";
import { UdpSocket, nodeLayer as udpNodeLayer } from "effect-node-udp";
import { execFileSync, spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

import { DtlsClient, nodeLayer } from "../src/index.js";
import { options } from "./Peer.js";

const openssl = process.env["OPENSSL"] ?? "openssl";
const available = (() => {
  try {
    return execFileSync(openssl, ["ciphers", "PSK-AES128-CCM8"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).includes("PSK-AES128-CCM8");
  } catch {
    return false;
  }
})();

const scopedLoopback = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
  (entries ?? [])
    .filter(
      (entry) =>
        entry.family === "IPv6" &&
        entry.internal &&
        entry.scopeid > 0 &&
        entry.address.startsWith("fe80:"),
    )
    .map((entry) => `${entry.address}%${name}`),
)[0];

const server = Effect.fnUntraced(function* (address: string, port: number) {
  const ready = yield* Deferred.make<void, Error>();
  const received = yield* Deferred.make<void, Error>();
  let errors = "";
  const child = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const child = spawn(
        openssl,
        [
          // OpenSSL's default policy excludes CCM's 64-bit tags. Only this test server
          // lowers policy to exercise the explicit IKEA compatibility cipher.
          "s_server",
          "-dtls1_2",
          "-nocert",
          "-cipher",
          "PSK-AES128-CCM8:@SECLEVEL=0",
          "-no_ticket",
          "-ign_eof",
          "-psk",
          Buffer.from(options.psk).toString("hex"),
          "-psk_identity",
          options.identity,
          "-accept",
          address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      const fail = (error: Error) => {
        Deferred.doneUnsafe(ready, Effect.fail(error));
        Deferred.doneUnsafe(received, Effect.fail(error));
      };
      child.stdout.on("data", (data: Buffer) => {
        output = (output + data.toString()).slice(-65536);
        if (output.includes("ACCEPT")) Deferred.doneUnsafe(ready, Effect.void);
        if (output.includes("effect-dtls-client-payload"))
          Deferred.doneUnsafe(received, Effect.void);
      });
      child.stderr.on("data", (data: Buffer) => {
        errors = (errors + data.toString()).slice(-4096);
      });
      child.on("error", fail);
      child.on("exit", (code, signal) =>
        fail(new Error(`OpenSSL exited (${code ?? signal}): ${errors}`)),
      );
      return child;
    }),
    (child) =>
      Effect.callback<void>((resume) => {
        if (child.exitCode !== null || child.signalCode !== null) return resume(Effect.void);
        child.once("close", () => resume(Effect.void));
        child.kill("SIGKILL");
      }),
  );
  yield* Deferred.await(ready);
  return {
    child,
    diagnostics: () => errors,
    received: Deferred.await(received),
    send: (data: string) =>
      Effect.callback<void, Error>((resume) => {
        child.stdin.write(data, (error) => resume(error ? Effect.fail(error) : Effect.void));
      }),
  };
});

describe("Production OpenSSL DTLS 1.2 PSK/CCM8 interoperability", () => {
  const test = available ? it.effect : it.effect.skip;
  test(
    "establishes IPv4/IPv6 sockets, including available scoped loopback, and transfers encrypted data both ways",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const udp = yield* UdpSocket;
          const dtls = yield* DtlsClient;
          for (const [type, address] of [
            ["udp4", "127.0.0.1"],
            ["udp6", "::1"],
            ...(scopedLoopback ? [["udp6", scopedLoopback] as const] : []),
          ] as const) {
            const probe = yield* udp.open({ type, address });
            const port = probe.localAddress.port;
            yield* probe.close;
            const remote = yield* server(address, port);
            const connection = yield* Effect.result(
              dtls.connect({ ...options, address, port, timeoutMs: 5000 }),
            );
            if (Result.isFailure(connection))
              return yield* Effect.fail(
                new Error(remote.diagnostics(), { cause: connection.failure }),
              );
            const socket = connection.success;
            assert.isTrue(socket.isOpen());
            yield* socket.send(Buffer.from("effect-dtls-client-payload\n"));
            yield* remote.received;
            yield* remote.send("effect-dtls-server-payload\n");
            assert.strictEqual(
              Buffer.from(yield* socket.receive).toString(),
              "effect-dtls-server-payload\n",
            );
            yield* socket.close;
            assert.isFalse(socket.isOpen());
            assert.isTrue(Result.isFailure(yield* Effect.result(socket.receive)));
          }
        }).pipe(Effect.provide(Layer.merge(nodeLayer, udpNodeLayer))),
      ),
    10000,
  );
});
