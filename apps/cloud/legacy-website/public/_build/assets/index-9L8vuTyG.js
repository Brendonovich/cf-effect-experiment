const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_build/assets/Editor-lYajbSK6.js","_build/assets/web-Dl2sEcME.js","_build/assets/solid-COykZtSy.js","_build/assets/round-share-4IwrIuPI.js","_build/assets/dialog-Cl8aIpB7.js","_build/assets/button-dTk4F7f6.js","_build/assets/ZUHR2BAH-DciGzthU.js","_build/assets/R5675YMU-C6EXqLl_.js","_build/assets/dots-horizontal-ZGk_uH4H.js","_build/assets/index-Canl0i0r.js","_build/assets/store-12zX8qse.js","_build/assets/index-Dic9SOHc.js","_build/assets/preload-helper-DPb_hSpc.js","_build/assets/json-ZCfGR0vq.js","_build/assets/createAsync-DflW-LI1.js","_build/assets/round-share-C11yF8C2.css","_build/assets/api-BeJqlYcr.js","_build/assets/action-DEY4sCLp.js","_build/assets/routing-KR3q6KJw.js","_build/assets/Logo-rCe3USwQ.js","_build/assets/Forms-t1wWmU5a.js","_build/assets/input-3faxl7mS.js","_build/assets/dropdown-menu-LCNp2cQP.js"])))=>i.map(i=>d[i]);
import { _ as __vitePreload } from "./preload-helper-DPb_hSpc.js";
import { g as getNextElement, a as getNextMarker, i as insert, t as template } from "./web-Dl2sEcME.js";
import { c as clientOnly } from "./clientOnly-D2mHZ0MZ.js";
import { b as createComponent } from "./solid-COykZtSy.js";
import { a as Meta } from "./index-Bo77jTwT.js";
import { L as Logo, H as HeaderAuthFallback } from "./Logo-rCe3USwQ.js";
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
var _tmpl$ = /* @__PURE__ */ template(`<div class="w-screen h-screen bg-neutral-900 text-white flex flex-col"><!$><!/><!$><!/><!$><!/><main class="flex-1 w-full bg-neutral-800 overflow-hidden">`), _tmpl$2 = /* @__PURE__ */ template(`<header class="w-full flex flex-row p-2 justify-between items-center h-12"><div class="flex-1 flex flex-row gap-2 items-center"><!$><!/><!$><!/></div><div class="text-sm font-medium"></div><div class="flex-1 flex flex-row justify-end items-center gap-1"><div class="flex-1 pl-2"><!$><!/><!$><!/></div><!$><!/>`);
const Editor = clientOnly(() => __vitePreload(() => import("./Editor-lYajbSK6.js"), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]) : void 0));
function index() {
  return (() => {
    var _el$ = getNextElement(_tmpl$), _el$3 = _el$.firstChild, [_el$4, _co$] = getNextMarker(_el$3.nextSibling), _el$5 = _el$4.nextSibling, [_el$6, _co$2] = getNextMarker(_el$5.nextSibling), _el$7 = _el$6.nextSibling, [_el$8, _co$3] = getNextMarker(_el$7.nextSibling), _el$2 = _el$8.nextSibling;
    insert(_el$, createComponent(Meta, {
      name: "mobile-web-app-capable",
      content: "yes"
    }), _el$4, _co$);
    insert(_el$, createComponent(Meta, {
      name: "viewport",
      content: "width=device-width, initial-scale=1, maximum-scale=1"
    }), _el$6, _co$2);
    insert(_el$, createComponent(Header, {}), _el$8, _co$3);
    insert(_el$2, createComponent(Editor, {}));
    return _el$;
  })();
}
const MenuItems = clientOnly(() => __vitePreload(() => import("./Editor-lYajbSK6.js"), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]) : void 0).then((i) => ({
  default: i.ConnectionsDialogButton
})));
const ProjectName = clientOnly(() => __vitePreload(() => import("./Editor-lYajbSK6.js"), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]) : void 0).then((i) => ({
  default: i.ProjectName
})));
const ExportButton = clientOnly(() => __vitePreload(() => import("./Editor-lYajbSK6.js"), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]) : void 0).then((i) => ({
  default: i.ExportButton
})));
const ShareButton = clientOnly(() => __vitePreload(() => import("./Editor-lYajbSK6.js"), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]) : void 0).then((i) => ({
  default: i.ShareButton
})));
const AuthSection = clientOnly(() => __vitePreload(() => import("./Logo-rCe3USwQ.js").then((n) => n.a), true ? __vite__mapDeps([19,1,2,11,10,16,17,18,20,21,5,14,22,6,7,4]) : void 0).then((i) => ({
  default: i.HeaderAuthSection
})));
function Header() {
  return (() => {
    var _el$9 = getNextElement(_tmpl$2), _el$0 = _el$9.firstChild, _el$1 = _el$0.firstChild, [_el$10, _co$4] = getNextMarker(_el$1.nextSibling), _el$11 = _el$10.nextSibling, [_el$12, _co$5] = getNextMarker(_el$11.nextSibling), _el$13 = _el$0.nextSibling, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.firstChild, [_el$17, _co$6] = getNextMarker(_el$16.nextSibling), _el$18 = _el$17.nextSibling, [_el$19, _co$7] = getNextMarker(_el$18.nextSibling), _el$20 = _el$15.nextSibling, [_el$21, _co$8] = getNextMarker(_el$20.nextSibling);
    insert(_el$0, createComponent(Logo, {}), _el$10, _co$4);
    insert(_el$0, createComponent(MenuItems, {}), _el$12, _co$5);
    insert(_el$13, createComponent(ProjectName, {}));
    insert(_el$15, createComponent(ExportButton, {}), _el$17, _co$6);
    insert(_el$15, createComponent(ShareButton, {}), _el$19, _co$7);
    insert(_el$14, createComponent(AuthSection, {
      get fallback() {
        return createComponent(HeaderAuthFallback, {});
      }
    }), _el$21, _co$8);
    return _el$9;
  })();
}
export {
  index as default
};
