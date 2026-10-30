import { g as getNextElement, t as template, a as getNextMarker, i as insert, f as className, c as setAttribute, s as spread, b as runHydrationEvents } from "./web-BrXyZ-Hv.js";
import { bp as LoadingBlock, bv as ClientRpcs, br as EffectButton } from "./index-CAYWkRW8.js";
import { d as cx } from "./button-BRzb2Wkz.js";
import { b as createComponent, F as For, m as mergeProps, h as Suspense, j as createRenderEffect, i as splitProps, q as createUniqueId } from "./solid-COykZtSy.js";
import { c as createStore } from "./store-12zX8qse.js";
import "./preload-helper-DPb_hSpc.js";
import "./dots-horizontal-2azE2fYH.js";
import "./ZUHR2BAH-DeUuezxO.js";
import "./R5675YMU-C6EXqLl_.js";
import "./index-Canl0i0r.js";
var _tmpl$ = /* @__PURE__ */ template(`<ul class="rounded divide-y divide-gray-6 gap-4">`), _tmpl$2 = /* @__PURE__ */ template(`<div class="flex flex-col gap-4"><!$><!/><div><span class="text-gray-11 font-medium text-xs">WebSocket Connections</span><!$><!/>`), _tmpl$3 = /* @__PURE__ */ template(`<div class="p-2 text-center text-gray-11 italic">No Connections`), _tmpl$4 = /* @__PURE__ */ template(`<div class="flex flex-col gap-3"><div class="flex flex-row gap-3"></div><div class="flex flex-row gap-3 items-end"><!$><!/><!$><!/>`), _tmpl$5 = /* @__PURE__ */ template(`<li class="flex flex-row py-2 w-full"><div class="flex flex-col gap-0.5"><span class=font-medium></span><div class="flex flex-row items-center gap-2"><div></div><pre class="text-xs text-gray-11"></pre></div></div><div class="flex-1 flex flex-row justify-end items-center gap-1"><!$><!/><!$><!/>`), _tmpl$6 = /* @__PURE__ */ template(`<div class="flex flex-col gap-1 flex-1 items-stretch"><label class="font-medium text-xs text-gray-11"></label><input class="bg-white/85 dark:bg-black/25 w-full h-8 text-sm px-2 ring-1 ring-gray-6 focus:ring-yellow-5 focus:outline-none">`);
const CONNECTION_INDICATOR = {
  connected: {
    class: "bg-green-600",
    label: "Connected"
  },
  disconnected: {
    class: "bg-red-600",
    label: "Disconnected"
  },
  connecting: {
    class: "bg-yellow-600",
    label: "Connecting"
  }
};
function Settings(props) {
  return (() => {
    var _el$ = getNextElement(_tmpl$2), _el$7 = _el$.firstChild, [_el$8, _co$2] = getNextMarker(_el$7.nextSibling), _el$2 = _el$8.nextSibling, _el$3 = _el$2.firstChild, _el$5 = _el$3.nextSibling, [_el$6, _co$] = getNextMarker(_el$5.nextSibling);
    insert(_el$, createComponent(AddWebSocketForm, props), _el$8, _co$2);
    insert(_el$2, createComponent(Suspense, {
      get fallback() {
        return createComponent(LoadingBlock, {});
      },
      get children() {
        var _el$4 = getNextElement(_tmpl$);
        insert(_el$4, createComponent(For, {
          get each() {
            return props.state?.connections ?? [];
          },
          get fallback() {
            return getNextElement(_tmpl$3);
          },
          children: (conn) => createComponent(ConnectionListItem, mergeProps(props, {
            conn
          }))
        }));
        return _el$4;
      }
    }), _el$6, _co$);
    return _el$;
  })();
}
function AddWebSocketForm(props) {
  const [addConnection, setAddConnection] = createStore({
    url: "ws://localhost:8080",
    name: void 0
  });
  return (() => {
    var _el$0 = getNextElement(_tmpl$4), _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling, _el$11 = _el$10.firstChild, [_el$12, _co$3] = getNextMarker(_el$11.nextSibling), _el$13 = _el$12.nextSibling, [_el$14, _co$4] = getNextMarker(_el$13.nextSibling);
    insert(_el$1, createComponent(InputField, {
      label: "Address",
      value: "ws://localhost:8080",
      onChange: (e) => setAddConnection("url", e.target.value)
    }));
    insert(_el$10, createComponent(InputField, {
      label: "Name",
      value: "",
      placeholder: "Optional",
      onChange: (e) => setAddConnection("name", e.target.value || void 0)
    }), _el$12, _co$3);
    insert(_el$10, createComponent(EffectButton, {
      onClick: () => props.rpc.AddWebSocket({
        url: addConnection.url,
        name: addConnection.name,
        connectOnStartup: true
      }),
      children: "Add WebSocket"
    }), _el$14, _co$4);
    return _el$0;
  })();
}
function ConnectionListItem(props) {
  const conn = () => props.conn;
  return (() => {
    var _el$15 = getNextElement(_tmpl$5), _el$16 = _el$15.firstChild, _el$17 = _el$16.firstChild, _el$18 = _el$17.nextSibling, _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling, _el$21 = _el$16.nextSibling, _el$22 = _el$21.firstChild, [_el$23, _co$5] = getNextMarker(_el$22.nextSibling), _el$24 = _el$23.nextSibling, [_el$25, _co$6] = getNextMarker(_el$24.nextSibling);
    insert(_el$17, () => conn().name ?? conn().url);
    insert(_el$20, () => conn().url);
    insert(_el$21, createComponent(EffectButton, {
      variant: "text",
      onClick: () => conn().state === "connected" ? props.rpc.DisconnectWebSocket({
        url: conn().url
      }) : props.rpc.ConnectWebSocket({
        url: conn().url
      }),
      get children() {
        return props.conn.state === "connected" ? "Disconnect" : "Connect";
      }
    }), _el$23, _co$5);
    insert(_el$21, createComponent(EffectButton, {
      variant: "textDanger",
      onClick: () => props.rpc.RemoveWebSocket({
        url: conn().url
      }),
      children: "Remove"
    }), _el$25, _co$6);
    createRenderEffect(() => className(_el$19, cx("size-2 rounded-full", CONNECTION_INDICATOR[conn().state].class)));
    return _el$15;
  })();
}
function InputField(props) {
  const [labelProps, inputProps] = splitProps(props, ["label"]);
  const id = createUniqueId();
  return (() => {
    var _el$26 = getNextElement(_tmpl$6), _el$27 = _el$26.firstChild, _el$28 = _el$27.nextSibling;
    setAttribute(_el$27, "for", id);
    insert(_el$27, () => labelProps.label);
    setAttribute(_el$28, "id", id);
    spread(_el$28, inputProps, false, false);
    runHydrationEvents();
    return _el$26;
  })();
}
const Rpcs = ClientRpcs;
export {
  Rpcs,
  Settings as default
};
