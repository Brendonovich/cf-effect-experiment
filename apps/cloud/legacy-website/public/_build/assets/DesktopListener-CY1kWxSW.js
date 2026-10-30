import { g as getNextElement, t as template, i as insert, a as getNextMarker } from "./web-BrXyZ-Hv.js";
import { c as createEventListener } from "./index-Canl0i0r.js";
import { b as createComponent, S as Show } from "./solid-COykZtSy.js";
import { t as toast } from "./index-DDhwvyeJ.js";
import { g as getAuthState } from "./api-Bu41SY_-.js";
import { u as useAction, b as action } from "./action-EmZbM2bN.js";
import { B as Button } from "./button-BRzb2Wkz.js";
import "./R5675YMU-C6EXqLl_.js";
import "./store-12zX8qse.js";
import "./routing-DEHGCM-R.js";
var _tmpl$ = /* @__PURE__ */ template(`<b>MacroGraph Desktop`), _tmpl$2 = /* @__PURE__ */ template(`<br>`), _tmpl$3 = /* @__PURE__ */ template(`<b>`), _tmpl$4 = /* @__PURE__ */ template(`<div class="flex flex-row gap-2 mt-2"><!$><!/><!$><!/>`);
const doDesktopAuth = action(async () => {
  try {
    const id = await fetch("http://localhost:25000").catch(() => {
    });
    if (!id) return;
    const auth = await getAuthState();
    const toastId = toast.info([getNextElement(_tmpl$), " detected.", getNextElement(_tmpl$2), createComponent(Show, {
      when: auth,
      fallback: void 0,
      children: (auth2) => ["Login as ", (() => {
        var _el$3 = getNextElement(_tmpl$3);
        insert(_el$3, () => auth2().user.email);
        return _el$3;
      })(), "?", (() => {
        var _el$4 = getNextElement(_tmpl$4), _el$5 = _el$4.firstChild, [_el$6, _co$] = getNextMarker(_el$5.nextSibling), _el$7 = _el$6.nextSibling, [_el$8, _co$2] = getNextMarker(_el$7.nextSibling);
        insert(_el$4, createComponent(Button, {
          variant: "secondary",
          onClick: async () => {
            await fetch("http://localhost:25000/session", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(auth2().session.id)
            });
            toast.success(["Login successful, head to ", getNextElement(_tmpl$)]);
          },
          children: "Login"
        }), _el$6, _co$);
        insert(_el$4, createComponent(Button, {
          variant: "default",
          onClick: () => toast.dismiss(toastId),
          children: "Cancel"
        }), _el$8, _co$2);
        return _el$4;
      })()]
    })]);
    return id;
  } catch (_e) {
    return void 0;
  }
});
function DesktopListener() {
  const desktopAuth = useAction(doDesktopAuth);
  desktopAuth();
  createEventListener(window, "focus", () => {
    desktopAuth();
  });
  return null;
}
export {
  DesktopListener as default
};
