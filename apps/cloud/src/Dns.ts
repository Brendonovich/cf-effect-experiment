import * as Cloudflare from "@alchemy.run/cloudflare";
import { adopt } from "alchemy/AdoptPolicy";
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
});

/**
 * Brendan's personal domain. MacroGraph needs `macrograph.brendonovich.dev`, the OAuth redirect
 * host every provider has registered, so the zone lives here; its other records are copied from
 * Vercel DNS and keep pointing at their existing hosts.
 */
export const BrendonovichDevZone = Cloudflare.Zone.Zone("BrendonovichDevZone", {
  name: "brendonovich.dev",
}).pipe(adopt(true));

const vercel = "cname.vercel-dns-017.com";
const protonDkim =
  "domainkey.dg32o657zt3l7e77d72ceuaoji5dpivjis5otaqbxxfa3rebbcyla.domains.proton.ch";

const brendonovichDevRecords: ReadonlyArray<
  readonly [
    id: string,
    record:
      | { readonly name: string; readonly type: "CNAME" | "TXT"; readonly content: string }
      | {
          readonly name: string;
          readonly type: "MX";
          readonly content: string;
          readonly priority: number;
        },
  ]
> = [
  // Vercel-hosted sites, including the root and every project subdomain.
  ["Apex", { name: "@", type: "CNAME", content: vercel }],
  ["Wildcard", { name: "*", type: "CNAME", content: vercel }],
  [
    "CapStaging",
    { name: "cap-staging", type: "CNAME", content: "782291c3b9fdd9bd.vercel-dns-016.com" },
  ],
  [
    "VercelVerification",
    {
      name: "_vercel",
      type: "TXT",
      content: "vc-domain-verify=cap-staging.brendonovich.dev,500a936df4703858cbe0",
    },
  ],
  // Proton Mail.
  ["MailMx", { name: "@", type: "MX", content: "mail.protonmail.ch", priority: 10 }],
  ["MailsecMx", { name: "@", type: "MX", content: "mailsec.protonmail.ch", priority: 20 }],
  ["Spf", { name: "@", type: "TXT", content: "v=spf1 include:_spf.protonmail.ch ~all" }],
  [
    "ProtonVerification",
    {
      name: "@",
      type: "TXT",
      content: "protonmail-verification=c4a73fa0cc65a9567cf0f934a211e05ab4803640",
    },
  ],
  [
    "ProtonDkim1",
    { name: "protonmail._domainkey", type: "CNAME", content: `protonmail.${protonDkim}` },
  ],
  [
    "ProtonDkim2",
    { name: "protonmail2._domainkey", type: "CNAME", content: `protonmail2.${protonDkim}` },
  ],
  [
    "ProtonDkim3",
    { name: "protonmail3._domainkey", type: "CNAME", content: `protonmail3.${protonDkim}` },
  ],
  ["Dmarc", { name: "_dmarc", type: "TXT", content: "v=DMARC1; p=none;" }],
  // Resend (Amazon SES) sending.
  [
    "SendMx",
    {
      name: "send",
      type: "MX",
      content: "feedback-smtp.ap-northeast-1.amazonses.com",
      priority: 10,
    },
  ],
  ["SendSpf", { name: "send", type: "TXT", content: "v=spf1 include:amazonses.com ~all" }],
  [
    "ResendDkim",
    {
      name: "resend._domainkey",
      type: "TXT",
      content:
        "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCxUsiP1+/aQ6V/3mQaX61M/vN7aXQgQ4hplLTvNemhwo57WuLjixlvwRcFPXfv+y7rGZGJovu/ZRC8pFIByAyZxN7xXArhSfNjlWYn6VBt2pSwpxRanCMBKaIsKd6t426GBP3lvpjRM+b+An3fVvTYGRHlCthy98I/pf2Lbn2h7QIDAQAB",
    },
  ],
  [
    "CapResendDkim",
    {
      name: "resend._domainkey.cap",
      type: "TXT",
      content:
        "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDecZub4wXkGTh0X0co4A3ci0P5shfRs3TKVLB9+W4uExLVvMyvzjnHBb7JXvDFQsvyx5LjBEvrQxzyyzaqlilP1JcXVQW/XCBP3rFOSW/ocnNlvkG9T6IXq4wriqU9C/mZqwfRIMZa0RCngOPNG2lyjbaT7L4wvKtt/396PouLnwIDAQAB",
    },
  ],
  // Other hosts and verifications.
  ["Cap", { name: "cap", type: "CNAME", content: "8hom37fl.up.railway.app" }],
  ["EventsocketApi", { name: "api.eventsocket", type: "CNAME", content: "eventsocket.fly.dev" }],
  [
    "Discord",
    { name: "_discord", type: "TXT", content: "dh=1c1a8d5a7fa528fe5974ec51918cfab88df0f55b" },
  ],
  ["Atproto", { name: "_atproto", type: "TXT", content: "did=did:plc:khkcv3dfixqoeivju6bkghbt" }],
];

export const brendonovichDevRecordSet = Effect.gen(function* () {
  const { zoneId } = yield* BrendonovichDevZone;
  yield* Effect.forEach(
    brendonovichDevRecords,
    ([id, record]) =>
      Cloudflare.DNS.Record(`BrendonovichDev${id}`, { zoneId, ttl: "1", ...record }),
    { discard: true },
  );
});
