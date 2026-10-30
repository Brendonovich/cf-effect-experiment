import { g as getNextElement, t as template, i as insert } from "./web-BrXyZ-Hv.js";
import { b as createComponent, n as Switch, M as Match, F as For, h as Suspense } from "./solid-COykZtSy.js";
import { B as Button } from "./button-BRzb2Wkz.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="flex flex-row gap-2">`), _tmpl$2 = /* @__PURE__ */ template(`<div class="flex flex-col space-y-2">`), _tmpl$3 = /* @__PURE__ */ template(`<div class=flex-1><span class="text-lg font-medium text-center"></span><ul class="w-full overflow-hidden min-w-0">`), _tmpl$4 = /* @__PURE__ */ template(`<li class="w-full overflow-hidden min-w-o truncate">`);
const Settings = ({
  access,
  requestAccess,
  io
}) => {
  return (() => {
    var _el$ = getNextElement(_tmpl$2);
    insert(_el$, createComponent(Suspense, {
      fallback: "Requesting MIDI Access...",
      get children() {
        return createComponent(Switch, {
          get children() {
            return [createComponent(Match, {
              get when() {
                return access() === null;
              },
              get children() {
                return ["MIDI Access Denied ", createComponent(Button, {
                  onClick: requestAccess,
                  children: "Retry"
                })];
              }
            }), createComponent(Match, {
              get when() {
                return access() === void 0;
              },
              get children() {
                return createComponent(Button, {
                  onClick: requestAccess,
                  children: "Request MIDI Access"
                });
              }
            }), createComponent(Match, {
              get when() {
                return access();
              },
              get children() {
                var _el$2 = getNextElement(_tmpl$);
                insert(_el$2, () => [["Inputs", io.inputs], ["Outputs", io.outputs]].map(([title, ports]) => (() => {
                  var _el$3 = getNextElement(_tmpl$3), _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling;
                  insert(_el$4, title);
                  insert(_el$5, createComponent(For, {
                    each: ports,
                    children: (input) => (() => {
                      var _el$6 = getNextElement(_tmpl$4);
                      insert(_el$6, () => input.name);
                      return _el$6;
                    })()
                  }));
                  return _el$3;
                })()));
                return _el$2;
              }
            })];
          }
        });
      }
    }));
    return _el$;
  })();
};
export {
  Settings as default
};
