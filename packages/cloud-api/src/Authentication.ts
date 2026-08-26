import { Context } from "effect";
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi";

export const sessionCookieName = "macrograph_session";
export const sessionSecurity = HttpApiSecurity.apiKey({ key: sessionCookieName, in: "cookie" });

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly id: string; readonly sessionId: string | undefined }
>()("CurrentUser") {}

export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser }
>()("Authentication", {
  error: HttpApiError.Unauthorized,
  security: { bearer: HttpApiSecurity.http({ scheme: "bearer" }) },
}) {}
