import { assert, describe, it } from "vitest";

import { tryWebsiteLogin } from "./websiteLogin";

const verificationUrl = "https://www.macrograph.app/server-registration?userCode=ABCD-1234";

describe("website login", () => {
  it("approves only the fresh registration using the website's own cookies", async () => {
    const calls: Array<{ input: Parameters<typeof fetch>[0]; init: RequestInit | undefined }> = [];
    const result = await tryWebsiteLogin(verificationUrl, async (input, init) => {
      calls.push({ input, init });
      return new Response(null, { status: 204 });
    });

    assert.strictEqual(result, "approved");
    assert.lengthOf(calls, 1);
    assert.strictEqual(calls[0]?.input, "https://www.macrograph.app/api/cloud-login");
    assert.strictEqual(calls[0]?.init?.credentials, "include");
    assert.strictEqual(calls[0]?.init?.method, "POST");
    assert.strictEqual(calls[0]?.init?.redirect, "error");
    assert.strictEqual(calls[0]?.init?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { userCode: "ABCD-1234" });
  });

  it("does not approve codes from unsafe or unrelated verification URLs", async () => {
    let calls = 0;
    for (const url of [
      "not a URL",
      "https://attacker.example/server-registration?userCode=ABCD-1234",
      "https://www.macrograph.app.attacker.example/server-registration?userCode=ABCD-1234",
      "http://www.macrograph.app/server-registration?userCode=ABCD-1234",
      "https://user:password@www.macrograph.app/server-registration?userCode=ABCD-1234",
      "https://www.macrograph.app/login?userCode=ABCD-1234",
      "https://www.macrograph.app/server-registration",
      "https://www.macrograph.app/server-registration?userCode=too-long-a-code",
    ]) {
      assert.strictEqual(
        await tryWebsiteLogin(url, async () => {
          calls++;
          return new Response(null, { status: 204 });
        }),
        "unavailable",
      );
    }
    assert.strictEqual(calls, 0);
  });

  it("leaves manual login available when the website is logged out or unavailable", async () => {
    for (const status of [200, 401, 403, 500]) {
      assert.strictEqual(
        await tryWebsiteLogin(verificationUrl, async () => new Response(null, { status })),
        "unavailable",
      );
    }
    assert.strictEqual(
      await tryWebsiteLogin(verificationUrl, async () => {
        throw new TypeError("Network error");
      }),
      "unavailable",
    );
  });

  it("requests a fresh attempt when the authenticated website rejects an expired code", async () => {
    assert.strictEqual(
      await tryWebsiteLogin(verificationUrl, async () => new Response(null, { status: 409 })),
      "retry",
    );
  });
});
