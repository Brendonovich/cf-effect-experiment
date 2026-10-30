const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_build/assets/Logo-rCe3USwQ.js","_build/assets/web-Dl2sEcME.js","_build/assets/solid-COykZtSy.js","_build/assets/index-Dic9SOHc.js","_build/assets/store-12zX8qse.js","_build/assets/api-BeJqlYcr.js","_build/assets/action-DEY4sCLp.js","_build/assets/routing-KR3q6KJw.js","_build/assets/Forms-t1wWmU5a.js","_build/assets/input-3faxl7mS.js","_build/assets/button-dTk4F7f6.js","_build/assets/createAsync-DflW-LI1.js","_build/assets/dropdown-menu-LCNp2cQP.js","_build/assets/ZUHR2BAH-DciGzthU.js","_build/assets/R5675YMU-C6EXqLl_.js","_build/assets/dialog-Cl8aIpB7.js"])))=>i.map(i=>d[i]);
import { _ as __vitePreload } from "./preload-helper-DPb_hSpc.js";
import { g as getNextElement, a as getNextMarker, i as insert, t as template } from "./web-Dl2sEcME.js";
import { c as clientOnly } from "./clientOnly-D2mHZ0MZ.js";
import { b as createComponent } from "./solid-COykZtSy.js";
import { L as Logo, H as HeaderAuthFallback } from "./Logo-rCe3USwQ.js";
import { A } from "./components-CTFPIzrW.js";
import "./index-Dic9SOHc.js";
import "./store-12zX8qse.js";
import "./api-BeJqlYcr.js";
import "./action-DEY4sCLp.js";
import "./routing-KR3q6KJw.js";
import "./Forms-t1wWmU5a.js";
import "./input-3faxl7mS.js";
import "./button-dTk4F7f6.js";
import "./createAsync-DflW-LI1.js";
import "./dropdown-menu-LCNp2cQP.js";
import "./ZUHR2BAH-DciGzthU.js";
import "./R5675YMU-C6EXqLl_.js";
import "./dialog-Cl8aIpB7.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="flex flex-col items-center"><header class="h-12 flex flex-row justify-between p-2 w-full items-center"><!$><!/><nav class="flex flex-row gap-2"><!$><!/><!$><!/></nav><!$><!/></header><!$><!/>`);
const AuthSection = clientOnly(() => __vitePreload(() => import("./Logo-rCe3USwQ.js").then((n) => n.a), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]) : void 0).then((i) => ({
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
