import { Context } from "effect";
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi";

export class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly id: string; readonly sessionId: string }
>()("CurrentUser") {}

export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: CurrentUser }
>()("Authentication", {
  error: HttpApiError.Unauthorized,
  requiredForClient: true,
  security: { session: HttpApiSecurity.bearer },
}) {}
