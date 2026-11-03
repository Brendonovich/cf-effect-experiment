/** How the gateway reaches a provider's API on behalf of a connected account. */
export interface Provider {
  readonly id: string;
  readonly displayName: string;
  readonly baseUrl: string;
  /** Origins tools may call with absolute URLs, besides `baseUrl`'s. */
  readonly origins?: ReadonlyArray<string>;
  readonly headers: (auth: Auth) => Readonly<Record<string, string>>;
}

export interface Auth {
  readonly accessToken: string;
  /** The OAuth application the token was issued to, which some APIs require. */
  readonly clientId: string | undefined;
}
