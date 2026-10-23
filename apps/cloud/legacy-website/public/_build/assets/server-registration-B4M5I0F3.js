import { d as delegateEvents, m as memo, g as getNextElement, t as template, c as setAttribute, i as insert, e as setProperty, b as runHydrationEvents, a as getNextMarker } from "./web-Dl2sEcME.js";
import { b as createComponent, u as untrack, S as Show, e as createSignal, M as Match, j as createRenderEffect, k as onMount, n as Switch } from "./solid-COykZtSy.js";
import { w as websiteRequest, e as ensureAuthedOrRedirect } from "./api-BeJqlYcr.js";
import { S as Screenshot } from "./App Logo-Cw4Q4SY2.js";
import { o as useSearchParams } from "./routing-KR3q6KJw.js";
import { c as createAsync } from "./createAsync-DflW-LI1.js";
import { b as action, q as query, u as useAction, c as useSubmission } from "./action-DEY4sCLp.js";
import { B as Button } from "./button-dTk4F7f6.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="mx-auto w-full max-w-lg flex flex-col items-center h-full"><div class="flex-1 flex flex-row items-end justify-center"><div class="flex flex-row items-center mb-8 space-x-4"><img class=w-24 alt="MacroGraph App Icon"><span class="text-5xl font-black mx-1">MacroGraph</span></div></div><div class="p-6 bg-neutral-800 border border-neutral-700 rounded-lg flex flex-col items-center space-y-5 text-center"></div><div class=flex-1>`), _tmpl$2 = /* @__PURE__ */ template(`<span class="font-medium text-3xl">Device Authentication`), _tmpl$3 = /* @__PURE__ */ template(`<span><span class=text-gray-200>Logged in as </span><b>`), _tmpl$4 = /* @__PURE__ */ template(`<span><b>Enter the code displayed on your device`), _tmpl$5 = /* @__PURE__ */ template(`<input type=text class="w-full h-16 text-3xl font-bold text-center bg-neutral-700 rounded border-neutral-600">`), _tmpl$6 = /* @__PURE__ */ template(`<p class="text-gray-400 text-sm mx-2">MacroGraph staff will never ask you to enter your code on this page`), _tmpl$7 = /* @__PURE__ */ template(`<span class="font-medium text-3xl">Confirm Authentication`), _tmpl$8 = /* @__PURE__ */ template(`<p>Are you sure you want to grant access to your MacroGraph account? The device will have access to all your credentials.`), _tmpl$9 = /* @__PURE__ */ template(`<div class="flex flex-row gap-2 w-full"><!$><!/><!$><!/>`);
const verifyUserCode = (userCode) => websiteRequest("/server-registration/verify", {
  method: "POST",
  body: {
    userCode
  }
});
const verifyUserCodeAction = action(verifyUserCode);
const grantAccessAction = action((userCode) => websiteRequest("/server-registration/grant", {
  method: "POST",
  body: {
    userCode
  }
}));
const getInitialState = query(async (userCode) => {
  const auth = await ensureAuthedOrRedirect();
  return {
    auth,
    userCode: userCode ?? "",
    userCodeValid: userCode ? await verifyUserCode(userCode) : false
  };
}, "getInitialState");
function Test() {
  const [searchParams] = useSearchParams();
  const initialState = createAsync(async () => await untrack(() => getInitialState(searchParams.userCode)), {
    deferStream: true
  });
  return createComponent(Show, {
    get when() {
      return initialState();
    },
    children: (initialState2) => createComponent(Inner, {
      get user() {
        return initialState2().auth.user;
      },
      get initialState() {
        return memo(() => !!initialState2().userCodeValid)() ? {
          state: "confirmation",
          code: initialState2().userCode
        } : {
          state: "enter-code"
        };
      }
    })
  });
}
function Inner(props) {
  const [, setSearchParams] = useSearchParams();
  const [step, setStep] = createSignal(props.initialState ?? {
    state: "enter-code"
  });
  return (() => {
    var _el$ = getNextElement(_tmpl$), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$2.nextSibling;
    setAttribute(_el$4, "src", Screenshot);
    insert(_el$5, createComponent(Switch, {
      get children() {
        return [createComponent(Match, {
          get when() {
            return step().state === "enter-code";
          },
          children: (_) => {
            const [code, setCode] = createSignal("");
            const verifyUserCode2 = useAction(verifyUserCodeAction);
            const submission = useSubmission(verifyUserCodeAction);
            const verifyAndContinue = (code2) => verifyUserCode2(code2).then((valid) => {
              if (valid) setStep({
                state: "confirmation",
                code: code2
              });
            });
            return [getNextElement(_tmpl$2), (() => {
              var _el$7 = getNextElement(_tmpl$3), _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling;
              insert(_el$9, () => props.user.email);
              return _el$7;
            })(), getNextElement(_tmpl$4), (() => {
              var _el$1 = getNextElement(_tmpl$5);
              _el$1.$$input = (e) => {
                const value = e.currentTarget.value;
                if (value.length > 9) return;
                setCode(e.currentTarget.value);
              };
              createRenderEffect(() => setProperty(_el$1, "value", code()));
              runHydrationEvents();
              return _el$1;
            })(), createComponent(Button, {
              "class": "w-full",
              get disabled() {
                return memo(() => !!submission.pending)() && code().length < 9;
              },
              onClick: () => {
                verifyAndContinue(code());
              },
              children: "Continue"
            }), getNextElement(_tmpl$6)];
          }
        }), createComponent(Match, {
          get when() {
            const s = step();
            if (s.state === "confirmation") return s;
          },
          children: (state) => {
            const grantAccess = useAction(grantAccessAction);
            const submission = useSubmission(grantAccessAction);
            onMount(() => {
              setSearchParams({
                userCode: void 0
              });
            });
            return [getNextElement(_tmpl$7), (() => {
              var _el$12 = getNextElement(_tmpl$3), _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling;
              insert(_el$14, () => props.user.email);
              return _el$12;
            })(), getNextElement(_tmpl$8), (() => {
              var _el$16 = getNextElement(_tmpl$9), _el$17 = _el$16.firstChild, [_el$18, _co$] = getNextMarker(_el$17.nextSibling), _el$19 = _el$18.nextSibling, [_el$20, _co$2] = getNextMarker(_el$19.nextSibling);
              insert(_el$16, createComponent(Button, {
                variant: "ghost",
                "class": "flex-1",
                get disabled() {
                  return submission.pending;
                },
                onClick: () => {
                  window.location.pathname = "/";
                },
                children: "Cancel"
              }), _el$18, _co$);
              insert(_el$16, createComponent(Button, {
                "class": "flex-1",
                get disabled() {
                  return submission.pending;
                },
                onClick: () => {
                  grantAccess(state().code).then(() => {
                    window.close();
                  });
                },
                children: "Continue"
              }), _el$20, _co$2);
              return _el$16;
            })()];
          }
        })];
      }
    }));
    return _el$;
  })();
}
delegateEvents(["input"]);
export {
  Test as default
};
