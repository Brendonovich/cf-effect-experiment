import { g as getNextElement, t as template, a as getNextMarker, i as insert } from "./web-Dl2sEcME.js";
import { S as Some, N as None } from "./round-share-4IwrIuPI.js";
import { b as createComponent, M as Match, n as Switch } from "./solid-COykZtSy.js";
import { c as createForm } from "./createForm-DVFhI0ml.js";
import { I as Input } from "./input-3faxl7mS.js";
import { B as Button } from "./button-dTk4F7f6.js";
import "./dialog-Cl8aIpB7.js";
import "./ZUHR2BAH-DciGzthU.js";
import "./R5675YMU-C6EXqLl_.js";
import "./dots-horizontal-ZGk_uH4H.js";
import "./index-Canl0i0r.js";
import "./store-12zX8qse.js";
import "./index-Dic9SOHc.js";
import "./preload-helper-DPb_hSpc.js";
import "./json-ZCfGR0vq.js";
import "./createAsync-DflW-LI1.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="flex flex-row items-center space-x-4">`), _tmpl$2 = /* @__PURE__ */ template(`<div class="flex flex-col space-y-2"><span class="text-neutral-400 font-medium">Open AI API</span><!$><!/>`), _tmpl$3 = /* @__PURE__ */ template(`<form class="flex flex-row space-x-4"><!$><!/><!$><!/>`);
function Settings({
  state,
  setKey,
  key
}) {
  return (() => {
    var _el$ = getNextElement(_tmpl$2), _el$2 = _el$.firstChild, _el$4 = _el$2.nextSibling, [_el$5, _co$] = getNextMarker(_el$4.nextSibling);
    insert(_el$, createComponent(Switch, {
      fallback: "Loading...",
      get children() {
        return [createComponent(Match, {
          get when() {
            return state().isNone();
          },
          children: (_) => {
            const form = createForm(() => ({
              defaultValues: {
                key: key().unwrapOr("")
              },
              onSubmit: ({
                value
              }) => {
                setKey(Some(value.key));
              }
            }));
            return (() => {
              var _el$6 = getNextElement(_tmpl$3), _el$7 = _el$6.firstChild, [_el$8, _co$2] = getNextMarker(_el$7.nextSibling), _el$9 = _el$8.nextSibling, [_el$0, _co$3] = getNextMarker(_el$9.nextSibling);
              _el$6.addEventListener("submit", (e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              });
              insert(_el$6, createComponent(form.Field, {
                name: "key",
                children: (field) => createComponent(Input, {
                  onInput: (e) => field().handleChange(e.currentTarget.value),
                  onBlur: () => field().handleBlur(),
                  get value() {
                    return field().state.value;
                  },
                  type: "password",
                  placeholder: "Open AI Key"
                })
              }), _el$8, _co$2);
              insert(_el$6, createComponent(Button, {
                type: "submit",
                "class": "shrink-0",
                size: "md",
                children: "Submit"
              }), _el$0, _co$3);
              return _el$6;
            })();
          }
        }), createComponent(Match, {
          get when() {
            return state().isSome();
          },
          get children() {
            var _el$3 = getNextElement(_tmpl$);
            insert(_el$3, createComponent(Button, {
              onClick: () => setKey(None),
              children: "Disconnect"
            }));
            return _el$3;
          }
        })];
      }
    }), _el$5, _co$);
    return _el$;
  })();
}
export {
  Settings as default
};
