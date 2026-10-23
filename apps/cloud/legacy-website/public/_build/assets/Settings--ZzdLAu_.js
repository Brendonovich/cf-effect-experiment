import { g as getNextElement, t as template, a as getNextMarker, i as insert, e as setProperty } from "./web-Dl2sEcME.js";
import { G as safeParseAsync, H as safeParse, J as object, K as optional, L as pipe, M as string, O as url } from "./round-share-4IwrIuPI.js";
import { b as createComponent, j as createRenderEffect, M as Match, F as For, n as Switch } from "./solid-COykZtSy.js";
import { c as createForm } from "./createForm-DVFhI0ml.js";
import { B as Button } from "./button-dTk4F7f6.js";
import { I as Input } from "./input-3faxl7mS.js";
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
function prefixSchemaToErrors(valiErrors, transformErrors) {
  const schema = /* @__PURE__ */ new Map();
  for (const valiError of valiErrors) {
    if (!valiError.path) continue;
    const path = valiError.path.map(({
      key: segment
    }) => typeof segment === "number" ? `[${segment}]` : segment).join(".").replace(/\.\[/g, "[");
    schema.set(path, (schema.get(path) ?? []).concat(valiError));
  }
  const transformedSchema = {};
  schema.forEach((value, key) => {
    transformedSchema[key] = transformErrors(value);
  });
  return transformedSchema;
}
function defaultFormTransformer(transformErrors) {
  return (zodErrors) => ({
    form: transformErrors(zodErrors),
    fields: prefixSchemaToErrors(zodErrors, transformErrors)
  });
}
const valibotValidator = (params = {}) => () => {
  const transformFieldErrors = params.transformErrors ?? ((issues) => issues.map((issue) => issue.message).join(", "));
  const getTransformStrategy = (validationSource) => validationSource === "form" ? defaultFormTransformer(transformFieldErrors) : transformFieldErrors;
  return {
    validate({
      value,
      validationSource
    }, fn) {
      if (fn.async) return;
      const result = safeParse(fn, value);
      if (result.success) return;
      const transformer = getTransformStrategy(validationSource);
      return transformer(result.issues);
    },
    async validateAsync({
      value,
      validationSource
    }, fn) {
      const result = await safeParseAsync(fn, value);
      if (result.success) return;
      const transformer = getTransformStrategy(validationSource);
      return transformer(result.issues);
    }
  };
};
const AUTH_SCHEMA = object({
  url: pipe(string(), url()),
  password: optional(string())
});
var _tmpl$ = /* @__PURE__ */ template(`<table class="mb-4 table-auto w-full text-white"><thead><tr><th class="pr-2 text-left">IP Address</th><th class="pr-2 text-left">State</th></tr></thead><!$><!/>`), _tmpl$2 = /* @__PURE__ */ template(`<form><fieldset class=space-y-4><div class="space-x-4 flex flex-row"><!$><!/><!$><!/><!$><!/>`), _tmpl$3 = /* @__PURE__ */ template(`<span class=mr-4>Disconnected`), _tmpl$4 = /* @__PURE__ */ template(`<tr><td><span></span></td><td></td><td>`);
function Settings(ctx) {
  const form = createForm(() => ({
    validatorAdapter: valibotValidator(),
    validators: {
      onSubmit: AUTH_SCHEMA
    },
    onSubmit: ({
      value
    }) => {
      ctx.addInstance(value.url, value.password);
      form.reset();
    },
    defaultValues: {
      url: "ws://localhost:4455"
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
            children: ([ip, instance]) => (() => {
              var _el$12 = getNextElement(_tmpl$4), _el$13 = _el$12.firstChild, _el$14 = _el$13.firstChild, _el$15 = _el$13.nextSibling, _el$17 = _el$15.nextSibling;
              insert(_el$14, ip);
              insert(_el$15, createComponent(Switch, {
                get children() {
                  return [createComponent(Match, {
                    get when() {
                      return instance.state === "connected" && instance;
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
                        onClick: () => ctx.connectInstance(ip),
                        children: "Connect"
                      })];
                    }
                  })];
                }
              }));
              insert(_el$17, createComponent(Button, {
                onClick: () => ctx.removeInstance(ip),
                children: "Remove"
              }));
              return _el$12;
            })()
          }), _el$4, _co$);
          return _el$;
        }
      });
    }
  }), (() => {
    var _el$5 = getNextElement(_tmpl$2), _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$8 = _el$7.firstChild, [_el$9, _co$2] = getNextMarker(_el$8.nextSibling), _el$0 = _el$9.nextSibling, [_el$1, _co$3] = getNextMarker(_el$0.nextSibling), _el$10 = _el$1.nextSibling, [_el$11, _co$4] = getNextMarker(_el$10.nextSibling);
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
    insert(_el$7, createComponent(form.Field, {
      name: "password",
      children: (field) => createComponent(Input, {
        onInput: (e) => field().handleChange(e.currentTarget.value),
        onBlur: () => field().handleBlur(),
        get value() {
          return field().state.value;
        },
        placeholder: "Password",
        type: "Password"
      })
    }), _el$1, _co$3);
    insert(_el$7, createComponent(Button, {
      type: "submit",
      "class": "shrink-0",
      size: "md",
      get children() {
        return !form.state.isSubmitting ? "Connect" : "Connecting...";
      }
    }), _el$11, _co$4);
    createRenderEffect(() => setProperty(_el$6, "disabled", form.state.isSubmitting));
    return _el$5;
  })()];
}
export {
  Settings as default
};
