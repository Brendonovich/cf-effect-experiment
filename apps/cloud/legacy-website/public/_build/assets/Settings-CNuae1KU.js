import { g as getNextElement, t as template, a as getNextMarker, i as insert, m as memo } from "./web-BrXyZ-Hv.js";
import { N as None, S as Some } from "./round-share-PHSh5hL2.js";
import { e as createSignal, b as createComponent, M as Match, h as Suspense, S as Show, n as Switch } from "./solid-COykZtSy.js";
import { B as Button } from "./button-BRzb2Wkz.js";
import "./dialog-C7UN_-MB.js";
import "./ZUHR2BAH-DeUuezxO.js";
import "./R5675YMU-C6EXqLl_.js";
import "./dots-horizontal-2azE2fYH.js";
import "./index-Canl0i0r.js";
import "./store-12zX8qse.js";
import "./index-DDhwvyeJ.js";
import "./preload-helper-DPb_hSpc.js";
import "./json-ZCfGR0vq.js";
import "./createAsync-DflW-LI1.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="flex space-x-4 items-center"><p>Logging in...</p><!$><!/>`), _tmpl$2 = /* @__PURE__ */ template(`<div class="flex flex-row items-center gap-2"><p>Logged in as <!$><!/></p><!$><!/>`);
function Settings({
  core,
  setAuthToken,
  authToken,
  user
}) {
  const [loggingIn, setLoggingIn] = createSignal(false);
  return createComponent(Switch, {
    get children() {
      return [createComponent(Match, {
        get when() {
          return memo(() => !!authToken().isSome())() && authToken().unwrap();
        },
        get children() {
          return createComponent(Suspense, {
            fallback: "Authenticating...",
            get children() {
              return createComponent(Show, {
                get when() {
                  return user();
                },
                children: (user2) => (() => {
                  var _el$5 = getNextElement(_tmpl$2), _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, [_el$9, _co$2] = getNextMarker(_el$8.nextSibling), _el$0 = _el$6.nextSibling, [_el$1, _co$3] = getNextMarker(_el$0.nextSibling);
                  insert(_el$6, () => user2().login, _el$9, _co$2);
                  insert(_el$5, createComponent(Button, {
                    onClick: () => setAuthToken(None),
                    children: "Log Out"
                  }), _el$1, _co$3);
                  return _el$5;
                })()
              });
            }
          });
        }
      }), createComponent(Match, {
        get when() {
          return loggingIn();
        },
        get children() {
          var _el$ = getNextElement(_tmpl$), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, [_el$4, _co$] = getNextMarker(_el$3.nextSibling);
          insert(_el$, createComponent(Button, {
            onClick: () => setLoggingIn(false),
            children: "Cancel"
          }), _el$4, _co$);
          return _el$;
        }
      }), createComponent(Match, {
        get when() {
          return !loggingIn();
        },
        get children() {
          return createComponent(Button, {
            onClick: async () => {
              setLoggingIn(true);
              try {
                const token = await core.oauth.authorize("github");
                if (!loggingIn()) return;
                setAuthToken(Some(token));
              } finally {
                setLoggingIn(false);
              }
            },
            children: "Login"
          });
        }
      })];
    }
  });
}
export {
  Settings as default
};
