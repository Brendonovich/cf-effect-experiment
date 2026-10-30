import { g as getNextElement, t as template, i as insert } from "./web-Dl2sEcME.js";
import "./solid-COykZtSy.js";
var _tmpl$ = /* @__PURE__ */ template(`<div>`);
function settings(ctx) {
  return (() => {
    var _el$ = getNextElement(_tmpl$);
    insert(_el$, () => ctx.state().isSome() ? "Connected" : "Disconnected");
    return _el$;
  })();
}
export {
  settings as default
};
