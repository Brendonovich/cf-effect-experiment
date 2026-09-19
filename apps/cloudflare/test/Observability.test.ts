import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "vitest";

import { axiomConfigured } from "../src/Observability.ts";

describe("Axiom configuration", () => {
  let token: string | undefined;
  let apiKey: string | undefined;

  beforeEach(() => {
    token = process.env.AXIOM_TOKEN;
    apiKey = process.env.AXIOM_API_KEY;
    delete process.env.AXIOM_TOKEN;
    delete process.env.AXIOM_API_KEY;
  });

  afterEach(() => {
    if (token === undefined) delete process.env.AXIOM_TOKEN;
    else process.env.AXIOM_TOKEN = token;
    if (apiKey === undefined) delete process.env.AXIOM_API_KEY;
    else process.env.AXIOM_API_KEY = apiKey;
  });

  it("is disabled when neither credential is configured", () => {
    assert.equal(axiomConfigured(), false);
  });

  it("accepts either supported credential", () => {
    process.env.AXIOM_TOKEN = "token";
    assert.equal(axiomConfigured(), true);
    delete process.env.AXIOM_TOKEN;
    process.env.AXIOM_API_KEY = "key";
    assert.equal(axiomConfigured(), true);
  });
});
