import { g as getNextElement, t as template, i as insert, a as getNextMarker, m as memo, c as setAttribute, e as setProperty, f as className, b as runHydrationEvents, d as delegateEvents } from "./web-BrXyZ-Hv.js";
import { bs as useEffectRuntime, br as EffectButton, bt as SUBSCRIPTION_TYPES, bp as LoadingBlock, bu as ClientRpcs } from "./index-CAYWkRW8.js";
import { d as cx, f as focusRingClasses } from "./button-BRzb2Wkz.js";
import { b as createComponent, I as Index, e as createSignal, S as Show, F as For, j as createRenderEffect, h as Suspense } from "./solid-COykZtSy.js";
import { e as IconTablerChevronRight } from "./dots-horizontal-2azE2fYH.js";
import "./preload-helper-DPb_hSpc.js";
import "./ZUHR2BAH-DeUuezxO.js";
import "./R5675YMU-C6EXqLl_.js";
import "./store-12zX8qse.js";
import "./index-Canl0i0r.js";
var _tmpl$ = /* @__PURE__ */ template(`<ul class="rounded divide-y divide-gray-6 w-full mt-2">`), _tmpl$2 = /* @__PURE__ */ template(`<div class="w-full -mt-1 space-y-4">`), _tmpl$3 = /* @__PURE__ */ template(`<div class="text-center p-2 text-gray-11 w-full italic">No Twitch accounts found`), _tmpl$4 = /* @__PURE__ */ template(`<span>`), _tmpl$5 = /* @__PURE__ */ template(`<div class=mt-2><span class="text-gray-11 font-medium text-xs mb-0.5">EventSub Subscriptions</span><div class="grid grid-cols-1 gap-1 max-h-[300px] overflow-y-auto mt-0.5">`), _tmpl$6 = /* @__PURE__ */ template(`<li class="flex flex-col w-full py-2 first:pt-0 last:pb-0"><div class="flex flex-row w-full items-center relative"><button></button><div class="flex-1 flex flex-col gap-0.5"><div class="flex flex-row items-center"><!$><!/><span class=font-medium></span></div><div class="flex flex-row items-center gap-2"><div></div><span class="text-xs text-gray-11 italic"></span></div></div><div class="flex items-center gap-2"><div class="relative group"></div></div></div><!$><!/>`), _tmpl$7 = /* @__PURE__ */ template(`<label class="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-4/50 rounded cursor-pointer group"><div class="flex flex-col"><span class=text-sm></span><a class="text-xs text-gray-11 hover:underline"target=_blank></a></div><div class="flex-1 h-full"></div><input type=checkbox class="size-4 rounded border border-gray-6 bg-gray-3 checked:bg-blue-600 checked:border-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">`);
const EVENTSUB_CONNECTION_INDICATOR = {
  connected: {
    class: "bg-green-600",
    label: "EventSub Connected"
  },
  disconnected: {
    class: "bg-red-600",
    label: "EventSub Disconnected"
  },
  connecting: {
    class: "bg-yellow-600",
    label: "EventSub Connecting"
  }
};
function Settings(props) {
  const runtime = useEffectRuntime();
  const formatSubscriptionName = (type) => {
    return type.replace(/^channel\./, "").replace(/\./g, " ").replace(/_/g, " ").split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  };
  return (() => {
    var _el$ = getNextElement(_tmpl$2);
    insert(_el$, createComponent(Suspense, {
      get fallback() {
        return createComponent(LoadingBlock, {});
      },
      get children() {
        var _el$2 = getNextElement(_tmpl$);
        insert(_el$2, createComponent(Index, {
          get each() {
            return props.state?.accounts ?? [];
          },
          get fallback() {
            return getNextElement(_tmpl$3);
          },
          children: (acc) => {
            const [expanded, setExpanded] = createSignal(false);
            const isExpanded = () => expanded();
            const enabledSubs = () => acc().enabledSubscriptions ?? [];
            return (() => {
              var _el$4 = getNextElement(_tmpl$6), _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$7.firstChild, _el$0 = _el$8.firstChild, [_el$1, _co$] = getNextMarker(_el$0.nextSibling), _el$9 = _el$1.nextSibling, _el$10 = _el$8.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$7.nextSibling, _el$14 = _el$13.firstChild, _el$19 = _el$5.nextSibling, [_el$20, _co$2] = getNextMarker(_el$19.nextSibling);
              _el$6.$$click = () => setExpanded((e) => !e);
              insert(_el$8, createComponent(IconTablerChevronRight, {
                "class": "size-4 -ml-1 mr-1 transition-transform",
                get classList() {
                  return {
                    "rotate-90": isExpanded()
                  };
                }
              }), _el$1, _co$);
              insert(_el$9, () => acc().displayName);
              insert(_el$12, () => EVENTSUB_CONNECTION_INDICATOR[acc().eventSubSocket.state].label);
              insert(_el$14, createComponent(EffectButton, {
                variant: "text",
                get disabled() {
                  return memo(() => acc().eventSubSocket.state !== "connected")() && enabledSubs().length === 0;
                },
                onClick: () => acc().eventSubSocket.state === "connected" ? props.rpc.DisconnectEventSub({
                  accountId: acc().id
                }) : props.rpc.ConnectEventSub({
                  accountId: acc().id
                }),
                get title() {
                  return acc().eventSubSocket.state !== "connected" && enabledSubs().length === 0 ? "Select at least one subscription topic to connect" : void 0;
                },
                get children() {
                  var _el$15 = getNextElement(_tmpl$4);
                  insert(_el$15, () => acc().eventSubSocket.state === "connected" ? "Disconnect" : "Connect");
                  return _el$15;
                }
              }));
              insert(_el$4, createComponent(Show, {
                get when() {
                  return isExpanded();
                },
                get children() {
                  var _el$16 = getNextElement(_tmpl$5), _el$17 = _el$16.firstChild, _el$18 = _el$17.nextSibling;
                  insert(_el$18, createComponent(For, {
                    each: SUBSCRIPTION_TYPES,
                    children: (subType) => {
                      const isEnabled = () => enabledSubs().includes(subType);
                      return (() => {
                        var _el$21 = getNextElement(_tmpl$7), _el$22 = _el$21.firstChild, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$22.nextSibling, _el$26 = _el$25.nextSibling;
                        insert(_el$23, () => formatSubscriptionName(subType));
                        insert(_el$24, subType);
                        _el$26.addEventListener("change", (e) => props.rpc.ToggleEventSubSubscription({
                          accountId: acc().id,
                          subscriptionType: subType,
                          enabled: e.currentTarget.checked
                        }).pipe(runtime.runPromise));
                        createRenderEffect((_p$) => {
                          var _v$3 = `https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#${subType.replaceAll(".", "")}`, _v$4 = isEnabled() && acc().eventSubSocket.state === "connected" && enabledSubs().length === 1, _v$5 = acc().eventSubSocket.state === "connected" && enabledSubs().length < 2 ? "Socket requires a least one subscription topic" : void 0;
                          _v$3 !== _p$.e && setAttribute(_el$24, "href", _p$.e = _v$3);
                          _v$4 !== _p$.t && setProperty(_el$26, "disabled", _p$.t = _v$4);
                          _v$5 !== _p$.a && setAttribute(_el$26, "title", _p$.a = _v$5);
                          return _p$;
                        }, {
                          e: void 0,
                          t: void 0,
                          a: void 0
                        });
                        createRenderEffect(() => setProperty(_el$26, "checked", isEnabled()));
                        return _el$21;
                      })();
                    }
                  }));
                  return _el$16;
                }
              }), _el$20, _co$2);
              createRenderEffect((_p$) => {
                var _v$ = cx("absolute -inset-2", focusRingClasses("outline")), _v$2 = cx("size-2 rounded-full", EVENTSUB_CONNECTION_INDICATOR[acc().eventSubSocket.state].class);
                _v$ !== _p$.e && className(_el$6, _p$.e = _v$);
                _v$2 !== _p$.t && className(_el$11, _p$.t = _v$2);
                return _p$;
              }, {
                e: void 0,
                t: void 0
              });
              runHydrationEvents();
              return _el$4;
            })();
          }
        }));
        return _el$2;
      }
    }));
    return _el$;
  })();
}
const Rpcs = ClientRpcs;
delegateEvents(["click"]);
export {
  Rpcs,
  Settings as default
};
