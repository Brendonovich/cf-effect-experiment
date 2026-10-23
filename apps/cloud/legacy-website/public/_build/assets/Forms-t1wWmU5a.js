import { d as delegateEvents, g as getNextElement, t as template, a as getNextMarker, i as insert, m as memo, e as setProperty, b as runHydrationEvents } from "./web-Dl2sEcME.js";
import { w as websiteRequest, g as getAuthState, a as getUser } from "./api-BeJqlYcr.js";
import { b as action, r as revalidate, u as useAction, c as useSubmission } from "./action-DEY4sCLp.js";
import { b as createComponent, j as createRenderEffect } from "./solid-COykZtSy.js";
import { I as Input } from "./input-3faxl7mS.js";
import { B as Button } from "./button-dTk4F7f6.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="text-white text-center space-y-4 flex flex-col items-center"><h1 class="font-semibold text-3xl">Log in to MacroGraph</h1><form><fieldset class="space-y-2 max-w-[16rem] w-full"><!$><!/><!$><!/><!$><!/><!$><!/><hr><span>Don't have an account? <button class=underline type=button>Sign Up`), _tmpl$2 = /* @__PURE__ */ template(`<span class=text-red-300>`), _tmpl$3 = /* @__PURE__ */ template(`<div class="text-white text-center space-y-4 flex flex-col items-center"><h1 class="font-semibold text-3xl">Sign up to MacroGraph</h1><form><fieldset class="space-y-2 max-w-[16rem] w-full"><!$><!/><!$><!/><!$><!/><!$><!/><hr><span class=mt-2>Already have an account? <button class=underline type=button>Log in`);
const submitCredentials = async (path, form) => {
  try {
    const result = await websiteRequest(path, {
      method: "POST",
      body: {
        email: form.get("email"),
        password: form.get("password")
      }
    });
    if (result.success) await revalidate([getAuthState.key, getUser.key]);
    return result;
  } catch (e) {
    return {
      success: false,
      error: e.toString()
    };
  }
};
const signUpAction = action((form) => submitCredentials("/signup", form));
const loginWithCredentialsAction = action((form) => submitCredentials("/login", form));
function LoginForm(props) {
  const loginWithCredentials = useAction(loginWithCredentialsAction);
  const submission = useSubmission(loginWithCredentialsAction);
  return (() => {
    var _el$ = getNextElement(_tmpl$), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.firstChild, _el$0 = _el$4.firstChild, [_el$1, _co$] = getNextMarker(_el$0.nextSibling), _el$10 = _el$1.nextSibling, [_el$11, _co$2] = getNextMarker(_el$10.nextSibling), _el$12 = _el$11.nextSibling, [_el$13, _co$3] = getNextMarker(_el$12.nextSibling), _el$14 = _el$13.nextSibling, [_el$15, _co$4] = getNextMarker(_el$14.nextSibling), _el$5 = _el$15.nextSibling, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild, _el$9 = _el$7.nextSibling;
    _el$3.addEventListener("submit", (e) => {
      e.preventDefault();
      loginWithCredentials(new FormData(e.currentTarget)).then((data) => data.success && props.onLogin?.(data.userId));
    });
    insert(_el$4, createComponent(Input, {
      name: "email",
      type: "email",
      placeholder: "Email Address"
    }), _el$1, _co$);
    insert(_el$4, createComponent(Input, {
      name: "password",
      type: "password",
      placeholder: "Password"
    }), _el$11, _co$2);
    insert(_el$4, (() => {
      var _c$ = memo(() => !!!submission.result?.success);
      return () => _c$() && (() => {
        var _el$16 = getNextElement(_tmpl$2);
        insert(_el$16, () => submission.result?.error);
        return _el$16;
      })();
    })(), _el$13, _co$3);
    insert(_el$4, createComponent(Button, {
      "class": "w-full",
      children: "Log in"
    }), _el$15, _co$4);
    _el$9.$$click = () => props.onSignup?.();
    createRenderEffect(() => setProperty(_el$4, "disabled", submission.pending));
    runHydrationEvents();
    return _el$;
  })();
}
function SignUpForm(props) {
  const signUp = useAction(signUpAction);
  const submission = useSubmission(signUpAction);
  return (() => {
    var _el$17 = getNextElement(_tmpl$3), _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$19.firstChild, _el$26 = _el$20.firstChild, [_el$27, _co$5] = getNextMarker(_el$26.nextSibling), _el$28 = _el$27.nextSibling, [_el$29, _co$6] = getNextMarker(_el$28.nextSibling), _el$30 = _el$29.nextSibling, [_el$31, _co$7] = getNextMarker(_el$30.nextSibling), _el$32 = _el$31.nextSibling, [_el$33, _co$8] = getNextMarker(_el$32.nextSibling), _el$21 = _el$33.nextSibling, _el$22 = _el$21.nextSibling, _el$23 = _el$22.firstChild, _el$25 = _el$23.nextSibling;
    _el$19.addEventListener("submit", (e) => {
      e.preventDefault();
      signUp(new FormData(e.currentTarget)).then((data) => data.success && props.onSignup?.(data.userId));
    });
    insert(_el$20, createComponent(Input, {
      name: "email",
      type: "email",
      placeholder: "Email Address"
    }), _el$27, _co$5);
    insert(_el$20, createComponent(Input, {
      name: "password",
      type: "password",
      placeholder: "Password"
    }), _el$29, _co$6);
    insert(_el$20, (() => {
      var _c$2 = memo(() => !!!submission.result?.success);
      return () => _c$2() && (() => {
        var _el$34 = getNextElement(_tmpl$2);
        insert(_el$34, () => submission.result?.error);
        return _el$34;
      })();
    })(), _el$31, _co$7);
    insert(_el$20, createComponent(Button, {
      "class": "w-full",
      children: "Create Account"
    }), _el$33, _co$8);
    _el$25.$$click = () => props.onLogin?.();
    createRenderEffect(() => setProperty(_el$20, "disabled", submission.pending));
    runHydrationEvents();
    return _el$17;
  })();
}
delegateEvents(["click"]);
export {
  LoginForm as L,
  SignUpForm as S
};
