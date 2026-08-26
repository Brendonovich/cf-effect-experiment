import { assert, describe, it } from "@effect/vitest";

import { Api } from "../src/api/Api.ts";
import { IngressApi } from "../src/ingress/IngressApi.ts";

describe("Cloudflare worker boundaries", () => {
  it("keeps public ingress separate from the website API", () => {
    assert.notProperty(Api.groups, "ingress");
    assert.deepStrictEqual(Object.keys(IngressApi.groups), ["ingress"]);
  });
});
