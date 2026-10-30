import { g as getNextElement, t as template, s as spread, b as runHydrationEvents } from "./web-BrXyZ-Hv.js";
import { i as splitProps, m as mergeProps } from "./solid-COykZtSy.js";
import { c as cn } from "./button-BRzb2Wkz.js";
var _tmpl$ = /* @__PURE__ */ template(`<input>`);
const Input = (props) => {
  const [, rest] = splitProps(props, ["type", "class"]);
  return (() => {
    var _el$ = getNextElement(_tmpl$);
    spread(_el$, mergeProps({
      get type() {
        return props.type;
      },
      get ["class"]() {
        return cn("border-input ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border bg-transparent px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50", props.class);
      }
    }, rest), false, false);
    runHydrationEvents();
    return _el$;
  })();
};
export {
  Input as I
};
