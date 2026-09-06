import * as S from "effect/Schema";

export const SocketAddress = S.String.pipe(S.brand("SocketAddress"));
export type SocketAddress = typeof SocketAddress.Type;
