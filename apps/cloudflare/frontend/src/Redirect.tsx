import { useNavigate } from "@solidjs/router";
import { untrack, type Component } from "solid-js";

export const Redirect: Component<{
  readonly href: string;
  readonly replace?: boolean;
  readonly resolve?: boolean;
}> = (props) => {
  const navigate = useNavigate();
  const replace = untrack(() => props.replace);
  const resolve = untrack(() => props.resolve);
  navigate(
    untrack(() => props.href),
    {
      ...(replace === undefined ? {} : { replace }),
      ...(resolve === undefined ? {} : { resolve }),
    },
  );
  return null;
};
