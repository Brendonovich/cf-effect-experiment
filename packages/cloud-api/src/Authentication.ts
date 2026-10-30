import { Context } from "effect";
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";

/** The MacroGraph account session cookie, issued by the website and shared by Cloud. */
export const sessionCookieName = "auth_session";

export class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()(
  "CurrentUser",
) {}

export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser }
>()("Authentication", {
  error: HttpApiError.Unauthorized,
  security: { bearer: HttpApiSecurity.http({ scheme: "bearer" }) },
}) {}
