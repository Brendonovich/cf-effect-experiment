import { g as getNextElement, a as getNextMarker, i as insert, t as template, m as memo } from "./web-Dl2sEcME.js";
import { h as getServers, b as addCredential } from "./api-BeJqlYcr.js";
import { b as createComponent, h as Suspense, S as Show } from "./solid-COykZtSy.js";
import { c as createAsync } from "./createAsync-DflW-LI1.js";
import { d as useSubmissions } from "./action-DEY4sCLp.js";
import "./routing-KR3q6KJw.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="h-full w-full max-w-3xl p-4 space-y-4"><header class="flex flex-row justify-between items-start text-white"><div class=space-y-1.5><h1 class="text-3xl font-medium">Servers</h1><p class="text-sm text-neutral-400">Add MacroGraph servers to your account to administrate them.</p></div></header><!$><!/>`), _tmpl$2 = /* @__PURE__ */ template(`<p class="p-4 text-sm text-medium text-center">No servers found`), _tmpl$3 = /* @__PURE__ */ template(`<ul class="border border-neutral-800 rounded-lg divide-y divide-neutral-800">`);
function servers() {
  return (() => {
    var _el$ = getNextElement(_tmpl$), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, [_el$4, _co$] = getNextMarker(_el$3.nextSibling);
    insert(_el$, createComponent(Suspense, {
      get children() {
        return createComponent(ServersList, {});
      }
    }), _el$4, _co$);
    return _el$;
  })();
}
function ServersList() {
  const servers2 = createAsync(() => getServers());
  const submissions = useSubmissions(addCredential);
  const pendingSubmissions = () => [...submissions].filter((s) => s.pending);
  return (() => {
    var _el$5 = getNextElement(_tmpl$3);
    insert(_el$5, createComponent(Show, {
      get when() {
        return memo(() => servers2()?.length === 0)() && pendingSubmissions().length === 0;
      },
      get children() {
        return getNextElement(_tmpl$2);
      }
    }));
    return _el$5;
  })();
}
export {
  servers as default
};
