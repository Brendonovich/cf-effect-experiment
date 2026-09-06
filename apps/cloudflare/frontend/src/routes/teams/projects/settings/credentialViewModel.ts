import type { Credential } from "@macrograph/module";

export const availableCredentials = (catalog: Credential.Catalog) =>
  catalog._tag === "CredentialCatalogAvailable" ? catalog.credentials : [];
