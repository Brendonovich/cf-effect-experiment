import { assert, it } from "vitest";

import { availableCredentials } from "./credentialViewModel";

it("models unavailable credential catalogs as empty", () => {
  const unavailable = {
    _tag: "CredentialCatalogUnavailable" as const,
    reason: { code: "no-provider" as const, message: "Local credentials are not configured." },
  };
  assert.deepEqual(availableCredentials(unavailable), []);

  const available = { _tag: "CredentialCatalogAvailable" as const, credentials: [] };
  assert.deepEqual(availableCredentials(available), []);
});
