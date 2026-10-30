import { Credential } from "@macrograph/module";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { Authentication } from "./Authentication.ts";

/** Read-only: credentials are connected and removed on the MacroGraph website. */
export class CredentialsApiGroup extends HttpApiGroup.make("credentials").add(
  HttpApiEndpoint.get("list", "/api/credentials", {
    success: Credential.Catalog,
  }).middleware(Authentication),
  HttpApiEndpoint.post("refetch", "/api/credentials/refetch", {
    success: Credential.Catalog,
  }).middleware(Authentication),
) {}
