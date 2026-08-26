import { Context, Effect, Layer, Schema } from "effect";

export class Rejected extends Schema.TaggedError<Rejected>()(
  "WebSocketUrlRejected",
  {
    reason: Schema.String,
  },
) {}

export class Service extends Context.Service<
  Service,
  { readonly check: (url: URL) => Effect.Effect<void, Rejected> }
>()("@macrograph/plugin-websocket-client/UrlPolicy") {}

const reject = (reason: string) => Effect.fail(new Rejected({ reason }));
const hostname = (url: URL) => url.hostname.toLowerCase().replace(/\.+$/, "");

const privateIpv4 = (host: string): boolean => {
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const publicIpv6 = (host: string): boolean => {
  const literal =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const halves = literal.split("::");
  if (halves.length > 2) return false;
  const parse = (half: string) =>
    half === ""
      ? []
      : half
          .split(":")
          .map((part) =>
            /^[0-9a-f]{1,4}$/i.test(part) ? Number.parseInt(part, 16) : -1,
          );
  const left = parse(halves[0] ?? "");
  const right = parse(halves[1] ?? "");
  if (left.includes(-1) || right.includes(-1)) return false;
  const omitted = 8 - left.length - right.length;
  if (
    (halves.length === 1 && omitted !== 0) ||
    (halves.length === 2 && omitted < 1)
  )
    return false;
  const segments = [
    ...left,
    ...Array.from({ length: omitted }, () => 0),
    ...right,
  ];
  const first = segments[0] ?? 0;
  const second = segments[1] ?? 0;
  return (
    (first & 0xe000) === 0x2000 &&
    first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x0200 || second === 0x0db8)) &&
    first !== 0x3ffe &&
    !(first === 0x3fff && (second & 0xf000) === 0)
  );
};

const commonCheck = (url: URL): Effect.Effect<void, Rejected> => {
  if (url.protocol !== "ws:" && url.protocol !== "wss:")
    return reject(`Protocol ${url.protocol || "(missing)"} is not allowed`);
  if (url.username !== "" || url.password !== "")
    return reject("URL credentials are not allowed");
  if (url.hash !== "") return reject("URL fragments are not allowed");
  return Effect.void;
};

export const make = (check: (url: URL) => Effect.Effect<void, Rejected>) =>
  Layer.succeed(Service)(
    Service.of({
      check: (url) => commonCheck(url).pipe(Effect.andThen(check(url))),
    }),
  );

export const secureLayer = make((url) => {
  if (url.protocol !== "wss:")
    return reject("Hosted WebSocket connections must use WSS");
  if (url.port !== "")
    return reject("Hosted WSS connections must use port 443");
  const host = hostname(url);
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "localdomain" ||
    host.endsWith(".localdomain") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "home.arpa" ||
    host.endsWith(".home.arpa") ||
    host === "metadata.google.internal"
  )
    return reject(`Host ${host} is not allowed`);
  // DNS rebinding also requires deployment-level egress controls; hostname checks cannot stop it.
  if (host.includes(":"))
    return publicIpv6(host)
      ? Effect.void
      : reject(`Host ${host} is not publicly routable`);
  if (privateIpv4(host)) return reject(`Host ${host} is not publicly routable`);
  if (!host.includes(".")) return reject(`Host ${host} is not allowed`);
  return Effect.void;
});

export const localLayer = make(() => Effect.void);

export * as UrlPolicy from "./UrlPolicy.ts";
