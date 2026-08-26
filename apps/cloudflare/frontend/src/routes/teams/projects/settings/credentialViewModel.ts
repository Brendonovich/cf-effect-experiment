import type { Credential } from "@macrograph/plugin";

export const availableCredentials = (catalog: Credential.Catalog) =>
  catalog._tag === "CredentialCatalogAvailable" ? catalog.credentials : [];
