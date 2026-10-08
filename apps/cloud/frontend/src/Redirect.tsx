import { useNavigate } from "@solidjs/router";
import { untrack, type Component } from "solid-js";

export const Redirect: Component<{
  readonly href: string;
  readonly replace?: boolean;
  readonly resolve?: boolean;
  /** Load the destination as a new document instead of navigating client-side. */
  readonly document?: boolean;
}> = (props) => {
  const navigate = useNavigate();
  const href = untrack(() => props.href);
  const replace = untrack(() => props.replace);
  const resolve = untrack(() => props.resolve);
  if (untrack(() => props.document)) {
    if (replace) window.location.replace(href);
    else window.location.assign(href);
    return null;
  }
  navigate(href, {
    ...(replace === undefined ? {} : { replace }),
    ...(resolve === undefined ? {} : { resolve }),
  });
  return null;
};
