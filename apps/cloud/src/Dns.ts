import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

/** The production `macrograph.app` zone, adopted if it already exists. Zones are retained on removal. */
export const MacroGraphZone = Cloudflare.Zone.Zone("MacroGraphZone", {
  name: "macrograph.app",
}).pipe(adopt(true));

/** Records for services hosted outside this stack. */
export const records = Effect.gen(function* () {
  const { zoneId } = yield* MacroGraphZone;
  const record = (
    id: string,
    props: {
      readonly name: string;
      readonly type: "CNAME" | "TXT" | "A";
      readonly content: string;
    },
  ) => Cloudflare.DNS.Record(id, { zoneId, ttl: "1", ...props });

  yield* record("JdudeRecord", {
    name: "jdude",
    type: "CNAME",
    content: "h29qe2ug.up.railway.app",
  });
  yield* record("JdudeRailwayVerification", {
    name: "_railway-verify.jdude",
    type: "TXT",
    content: "railway-verify=54f02d4922727a645741c5f382d1f0038f714fc27c11331be68061c7eb2758e0",
  });
  yield* record("DevRecord", { name: "dev", type: "CNAME", content: "0rtj44rq.up.railway.app" });
  yield* record("AtprotoRecord", {
    name: "_atproto",
    type: "TXT",
    content: "did=did:plc:4nujv54vmeuwqkxel24zqnbu",
  });

  // Keep the current hosts reachable while nameservers move; replaced by Worker custom domains.
  yield* record("TransitionApexRecord", { name: "@", type: "A", content: "76.76.21.21" });
  yield* record("TransitionWwwRecord", {
    name: "www",
    type: "CNAME",
    content: "cname.vercel-dns.com",
  });
  yield* record("TransitionCloudRecord", {
    name: "cloud",
    type: "CNAME",
    content: "macrograph-cloud.pages.dev",
  });
});
