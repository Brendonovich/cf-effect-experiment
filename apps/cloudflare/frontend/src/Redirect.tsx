import { useNavigate } from "@solidjs/router";
import { untrack, type Component } from "solid-js";

export const Redirect: Component<{ readonly href: string; readonly replace?: boolean }> = (
  props,
) => {
  const navigate = useNavigate();
  const replace = untrack(() => props.replace);
  navigate(
    untrack(() => props.href),
    replace === undefined ? undefined : { replace },
  );
  return null;
};
