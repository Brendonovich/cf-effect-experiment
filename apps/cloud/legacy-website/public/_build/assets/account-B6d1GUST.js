const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_build/assets/Logo-CpfnBNa8.js","_build/assets/web-BrXyZ-Hv.js","_build/assets/solid-COykZtSy.js","_build/assets/index-DDhwvyeJ.js","_build/assets/store-12zX8qse.js","_build/assets/api-Bu41SY_-.js","_build/assets/action-EmZbM2bN.js","_build/assets/routing-DEHGCM-R.js","_build/assets/Forms-B9BXEkzt.js","_build/assets/input-C0_oeT8V.js","_build/assets/button-BRzb2Wkz.js","_build/assets/createAsync-DflW-LI1.js","_build/assets/ZUHR2BAH-DeUuezxO.js","_build/assets/R5675YMU-C6EXqLl_.js","_build/assets/dialog-C7UN_-MB.js"])))=>i.map(i=>d[i]);
import { _ as __vitePreload } from "./preload-helper-DPb_hSpc.js";
import { g as getNextElement, a as getNextMarker, i as insert, t as template } from "./web-BrXyZ-Hv.js";
import { c as clientOnly } from "./clientOnly-D2mHZ0MZ.js";
import { b as createComponent } from "./solid-COykZtSy.js";
import { L as Logo, H as HeaderAuthFallback } from "./Logo-CpfnBNa8.js";
import { A } from "./components-D19taJrn.js";
import "./index-DDhwvyeJ.js";
import "./store-12zX8qse.js";
import "./api-Bu41SY_-.js";
import "./action-EmZbM2bN.js";
import "./routing-DEHGCM-R.js";
import "./Forms-B9BXEkzt.js";
import "./input-C0_oeT8V.js";
import "./button-BRzb2Wkz.js";
import "./createAsync-DflW-LI1.js";
import "./ZUHR2BAH-DeUuezxO.js";
import "./R5675YMU-C6EXqLl_.js";
import "./dialog-C7UN_-MB.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="flex flex-col items-center"><header class="h-12 flex flex-row justify-between p-2 w-full items-center"><!$><!/><nav class="flex flex-row gap-2"><!$><!/><!$><!/></nav><!$><!/></header><!$><!/>`);
const AuthSection = clientOnly(() => __vitePreload(() => import("./Logo-CpfnBNa8.js").then((n) => n.d), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14]) : void 0).then((i) => ({
  default: i.HeaderAuthSection
})));
function account(props) {
  return (() => {
    var _el$ = getNextElement(_tmpl$), _el$2 = _el$.firstChild, _el$8 = _el$2.firstChild, [_el$9, _co$3] = getNextMarker(_el$8.nextSibling), _el$3 = _el$9.nextSibling, _el$4 = _el$3.firstChild, [_el$5, _co$] = getNextMarker(_el$4.nextSibling), _el$6 = _el$5.nextSibling, [_el$7, _co$2] = getNextMarker(_el$6.nextSibling), _el$0 = _el$3.nextSibling, [_el$1, _co$4] = getNextMarker(_el$0.nextSibling), _el$10 = _el$2.nextSibling, [_el$11, _co$5] = getNextMarker(_el$10.nextSibling);
    insert(_el$2, createComponent(Logo, {}), _el$9, _co$3);
    insert(_el$3, createComponent(A, {
      href: "credentials",
      activeClass: "underline",
      children: "Credentials"
    }), _el$5, _co$);
    insert(_el$3, createComponent(A, {
      href: "servers",
      activeClass: "underline",
      children: "Servers"
    }), _el$7, _co$2);
    insert(_el$2, createComponent(AuthSection, {
      get fallback() {
        return createComponent(HeaderAuthFallback, {});
      }
    }), _el$1, _co$4);
    insert(_el$, () => props.children, _el$11, _co$5);
    return _el$;
  })();
}
export {
  account as default
};
