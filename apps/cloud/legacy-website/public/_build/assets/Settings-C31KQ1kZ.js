import { g as getNextElement, t as template, a as getNextMarker, i as insert, e as setProperty } from "./web-Dl2sEcME.js";
import { b as createComponent, j as createRenderEffect, M as Match, F as For, n as Switch } from "./solid-COykZtSy.js";
import { c as createForm } from "./createForm-DVFhI0ml.js";
import { B as Button } from "./button-dTk4F7f6.js";
import { I as Input } from "./input-3faxl7mS.js";
var _tmpl$ = /* @__PURE__ */ template(`<table class="mb-4 table-auto w-full text-white"><thead><tr><th class="pr-2 text-left">IP Address</th><th class="pr-2 text-left">State</th></tr></thead><!$><!/>`), _tmpl$2 = /* @__PURE__ */ template(`<form><fieldset class=space-y-4><div class="space-x-4 flex flex-row items-center"><!$><!/><!$><!/>`), _tmpl$3 = /* @__PURE__ */ template(`<span class=mr-4>Disconnected`), _tmpl$4 = /* @__PURE__ */ template(`<tr><td><span></span></td><td></td><td>`);
const Settings = (ctx) => {
  const form = createForm(() => ({
    defaultValues: {
      url: "ws://localhost:8001"
    },
    onSubmit: ({
      value
    }) => {
      ctx.addInstance(value.url);
      form.reset();
    }
  }));
  return [createComponent(Switch, {
    get children() {
      return createComponent(Match, {
        get when() {
          return ctx.instances.size !== 0;
        },
        get children() {
          var _el$ = getNextElement(_tmpl$), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, [_el$4, _co$] = getNextMarker(_el$3.nextSibling);
          insert(_el$, createComponent(For, {
            get each() {
              return [...ctx.instances];
            },
            children: ([url, instance]) => (() => {
              var _el$10 = getNextElement(_tmpl$4), _el$11 = _el$10.firstChild, _el$12 = _el$11.firstChild, _el$13 = _el$11.nextSibling, _el$15 = _el$13.nextSibling;
              insert(_el$12, url);
              insert(_el$13, createComponent(Switch, {
                get children() {
                  return [createComponent(Match, {
                    get when() {
                      return instance.state === "connected";
                    },
                    children: "Connected"
                  }), createComponent(Match, {
                    get when() {
                      return instance.state === "connecting";
                    },
                    children: "Connecting"
                  }), createComponent(Match, {
                    get when() {
                      return instance.state === "disconnected";
                    },
                    get children() {
                      return [getNextElement(_tmpl$3), createComponent(Button, {
                        onClick: () => ctx.addInstance(url),
                        children: "Connect"
                      })];
                    }
                  })];
                }
              }));
              insert(_el$15, createComponent(Button, {
                onClick: () => ctx.removeInstance(url),
                children: "Remove"
              }));
              return _el$10;
            })()
          }), _el$4, _co$);
          return _el$;
        }
      });
    }
  }), (() => {
    var _el$5 = getNextElement(_tmpl$2), _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$8 = _el$7.firstChild, [_el$9, _co$2] = getNextMarker(_el$8.nextSibling), _el$0 = _el$9.nextSibling, [_el$1, _co$3] = getNextMarker(_el$0.nextSibling);
    _el$5.addEventListener("submit", (e) => {
      e.preventDefault();
      e.stopPropagation();
      form.handleSubmit();
    });
    insert(_el$7, createComponent(form.Field, {
      name: "url",
      children: (field) => createComponent(Input, {
        onInput: (e) => field().handleChange(e.currentTarget.value),
        onBlur: () => field().handleBlur(),
        get value() {
          return field().state.value;
        },
        placeholder: "URL",
        required: true
      })
    }), _el$9, _co$2);
    insert(_el$7, createComponent(Button, {
      type: "submit",
      "class": "shrink-0",
      size: "md",
      get children() {
        return !form.state.isSubmitting ? "Connect" : "Connecting...";
      }
    }), _el$1, _co$3);
    createRenderEffect(() => setProperty(_el$6, "disabled", form.state.isSubmitting));
    return _el$5;
  })()];
};
export {
  Settings as default
};
