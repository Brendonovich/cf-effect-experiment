import { g as getNextElement, a as getNextMarker, i as insert, t as template, m as memo, c as setAttribute } from "./web-Dl2sEcME.js";
import { t as toast } from "./index-Dic9SOHc.js";
import { b as addCredential, P as PROVIDER_DISPLAY_NAMES, W as WINDOW_OPEN_FAILED, c as getCredentials, d as removeCredential } from "./api-BeJqlYcr.js";
import { b as createComponent, h as Suspense, F as For, S as Show, j as createRenderEffect } from "./solid-COykZtSy.js";
import { u as useAction, d as useSubmissions, c as useSubmission } from "./action-DEY4sCLp.js";
import { c as DropdownMenuTrigger, D as DropdownMenuContent, a as DropdownMenuItem, b as DropdownMenu } from "./dropdown-menu-LCNp2cQP.js";
import { B as Button } from "./button-dTk4F7f6.js";
import { c as createAsync } from "./createAsync-DflW-LI1.js";
import "./store-12zX8qse.js";
import "./routing-KR3q6KJw.js";
import "./ZUHR2BAH-DciGzthU.js";
import "./R5675YMU-C6EXqLl_.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="h-full w-full max-w-3xl p-4 space-y-4"><header class="flex flex-row justify-between items-start text-white"><div class=space-y-1.5><h1 class="text-3xl font-medium">Credentials</h1><p class="text-sm text-neutral-400">Add credentials to your account to use them within MacroGraph.</p></div><!$><!/></header><!$><!/>`), _tmpl$2 = /* @__PURE__ */ template(`<b>`), _tmpl$3 = /* @__PURE__ */ template(`<p class="p-4 text-sm text-medium text-center">No connections found`), _tmpl$4 = /* @__PURE__ */ template(`<ul class="border border-neutral-800 rounded-lg divide-y divide-neutral-800"><!$><!/><!$><!/><!$><!/>`), _tmpl$5 = /* @__PURE__ */ template(`<li class="p-4 flex flex-row items-center space-x-4 text-base"><div><h3 class=font-medium>Connecting...</h3><span class=" text-sm text-neutral-400"></span></div><div class=flex-1></div><!$><!/>`), _tmpl$6 = /* @__PURE__ */ template(`<li class="p-4 flex flex-row items-center space-x-4 text-base"><div><h3 class=font-medium></h3><span class=" text-sm text-neutral-400"></span></div><div class=flex-1></div><form method=post>`);
function credentials() {
  return (() => {
    var _el$ = getNextElement(_tmpl$), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, [_el$5, _co$] = getNextMarker(_el$4.nextSibling), _el$6 = _el$2.nextSibling, [_el$7, _co$2] = getNextMarker(_el$6.nextSibling);
    insert(_el$2, createComponent(AddCredentialButton, {}), _el$5, _co$);
    insert(_el$, createComponent(Suspense, {
      get children() {
        return createComponent(CredentialsList, {});
      }
    }), _el$7, _co$2);
    return _el$;
  })();
}
const PROVIDER_LIST = [
  "twitch",
  "discord"
  // "spotify",
  // "patreon",
  // "github",
];
function AddCredentialButton() {
  const doAddCredential = useAction(addCredential);
  return createComponent(DropdownMenu, {
    get children() {
      return [createComponent(DropdownMenuTrigger, {
        as: Button,
        children: "Add Credential"
      }), createComponent(DropdownMenuContent, {
        get children() {
          return createComponent(For, {
            each: PROVIDER_LIST,
            children: (provider) => createComponent(DropdownMenuItem, {
              onClick: () => {
                doAddCredential(provider).then((cred) => {
                  toast.success(["Credential ", (() => {
                    var _el$8 = getNextElement(_tmpl$2);
                    insert(_el$8, () => cred.user.displayName);
                    return _el$8;
                  })(), " added for", " ", (() => {
                    var _el$9 = getNextElement(_tmpl$2);
                    insert(_el$9, () => PROVIDER_DISPLAY_NAMES[provider]);
                    return _el$9;
                  })()]);
                }).catch((e) => {
                  if (e instanceof Error && e.message === WINDOW_OPEN_FAILED) {
                    toast.error("Failed to open login window. Make sure your browser isn't blocking popups.");
                  }
                });
              },
              get children() {
                return PROVIDER_DISPLAY_NAMES[provider];
              }
            })
          });
        }
      })];
    }
  });
}
function CredentialsList() {
  const credentials2 = createAsync(() => getCredentials());
  const submissions = useSubmissions(addCredential);
  const pendingsubmissions = () => [...submissions].filter((s) => s.pending);
  return (() => {
    var _el$0 = getNextElement(_tmpl$4), _el$10 = _el$0.firstChild, [_el$11, _co$3] = getNextMarker(_el$10.nextSibling), _el$12 = _el$11.nextSibling, [_el$13, _co$4] = getNextMarker(_el$12.nextSibling), _el$14 = _el$13.nextSibling, [_el$15, _co$5] = getNextMarker(_el$14.nextSibling);
    insert(_el$0, createComponent(Show, {
      get when() {
        return memo(() => credentials2()?.length === 0)() && pendingsubmissions().length === 0;
      },
      get children() {
        return getNextElement(_tmpl$3);
      }
    }), _el$11, _co$3);
    insert(_el$0, createComponent(For, {
      get each() {
        return pendingsubmissions();
      },
      children: (submission) => (() => {
        var _el$16 = getNextElement(_tmpl$5), _el$17 = _el$16.firstChild, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$17.nextSibling, _el$21 = _el$20.nextSibling, [_el$22, _co$6] = getNextMarker(_el$21.nextSibling);
        insert(_el$19, () => PROVIDER_DISPLAY_NAMES[submission.input[0]]);
        insert(_el$16, createComponent(Button, {
          size: "sm",
          onClick: () => submission.clear(),
          children: "Cancel"
        }), _el$22, _co$6);
        return _el$16;
      })()
    }), _el$13, _co$4);
    insert(_el$0, createComponent(For, {
      get each() {
        return credentials2();
      },
      children: (connection) => {
        const removeSubmission = useSubmission(removeCredential, (s) => s[0] === connection.providerId && s[1] === connection.providerUserId);
        return (() => {
          var _el$23 = getNextElement(_tmpl$6), _el$24 = _el$23.firstChild, _el$25 = _el$24.firstChild, _el$26 = _el$25.nextSibling, _el$27 = _el$24.nextSibling, _el$28 = _el$27.nextSibling;
          insert(_el$25, () => connection.displayName);
          insert(_el$26, () => PROVIDER_DISPLAY_NAMES[connection.providerId]);
          insert(_el$28, createComponent(Button, {
            variant: "destructive",
            type: "submit",
            size: "sm",
            get disabled() {
              return removeSubmission.pending;
            },
            get children() {
              return createComponent(Show, {
                get when() {
                  return removeSubmission.pending;
                },
                fallback: "Remove",
                children: "Removing..."
              });
            }
          }));
          createRenderEffect(() => setAttribute(_el$28, "action", removeCredential.with(connection.providerId, connection.providerUserId)));
          return _el$23;
        })();
      }
    }), _el$15, _co$5);
    return _el$0;
  })();
}
export {
  credentials as default
};
