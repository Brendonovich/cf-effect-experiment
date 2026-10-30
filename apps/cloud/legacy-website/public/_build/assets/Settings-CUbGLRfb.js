import { g as getNextElement, t as template, a as getNextMarker, i as insert, m as memo, f as className, c as setAttribute, s as spread, b as runHydrationEvents } from "./web-BrXyZ-Hv.js";
import { bp as LoadingBlock, bw as ClientRpcs, br as EffectButton } from "./index-CAYWkRW8.js";
import { d as cx } from "./button-BRzb2Wkz.js";
import { b as createComponent, F as For, m as mergeProps, h as Suspense, j as createRenderEffect, i as splitProps, q as createUniqueId } from "./solid-COykZtSy.js";
import { c as createStore } from "./store-12zX8qse.js";
import "./preload-helper-DPb_hSpc.js";
import "./dots-horizontal-2azE2fYH.js";
import "./ZUHR2BAH-DeUuezxO.js";
import "./R5675YMU-C6EXqLl_.js";
import "./index-Canl0i0r.js";
var _tmpl$ = /* @__PURE__ */ template(`<ul class="rounded divide-y divide-gray-6 gap-4">`), _tmpl$2 = /* @__PURE__ */ template(`<div class="flex flex-col gap-4"><!$><!/><div><span class="text-gray-11 font-medium text-xs">WebSocket Servers</span><!$><!/>`), _tmpl$3 = /* @__PURE__ */ template(`<div class="p-2 text-center text-gray-11 italic">No Servers`), _tmpl$4 = /* @__PURE__ */ template(`<div class="flex flex-col gap-3"><div class="flex flex-row gap-3 items-end"><div class=w-1/3></div><div class=w-2/3></div></div><div class="flex flex-row gap-3 items-end"><div class=flex-1></div><!$><!/>`), _tmpl$5 = /* @__PURE__ */ template(`<li class="flex flex-row py-2 w-full"><div class="flex flex-col gap-0.5"><div class="flex flex-row items-center gap-2"><span class=font-medium></span><!$><!/></div><div class="flex flex-row items-center gap-2"><div></div><span class="text-xs text-gray-11"><!$><!/><!$><!/></span></div></div><div class="flex-1 flex flex-row justify-end items-center gap-1"><!$><!/><!$><!/>`), _tmpl$6 = /* @__PURE__ */ template(`<span class="text-xs text-gray-11">(Port <!$><!/>)`), _tmpl$7 = /* @__PURE__ */ template(`<div class="flex flex-col gap-1 flex-1 items-stretch"><label class="font-medium text-xs text-gray-11"></label><input class="bg-white/85 dark:bg-black/25 w-full h-8 text-sm px-2 ring-1 ring-gray-6 focus:ring-yellow-5 focus:outline-none">`);
const SERVER_STATE_INDICATOR = {
  running: {
    class: "bg-green-600",
    label: "Running"
  },
  stopped: {
    class: "bg-red-600",
    label: "Stopped"
  },
  error: {
    class: "bg-yellow-600",
    label: "Error"
  }
};
function Settings(props) {
  return (() => {
    var _el$ = getNextElement(_tmpl$2), _el$7 = _el$.firstChild, [_el$8, _co$2] = getNextMarker(_el$7.nextSibling), _el$2 = _el$8.nextSibling, _el$3 = _el$2.firstChild, _el$5 = _el$3.nextSibling, [_el$6, _co$] = getNextMarker(_el$5.nextSibling);
    insert(_el$, createComponent(AddServerForm, props), _el$8, _co$2);
    insert(_el$2, createComponent(Suspense, {
      get fallback() {
        return createComponent(LoadingBlock, {});
      },
      get children() {
        var _el$4 = getNextElement(_tmpl$);
        insert(_el$4, createComponent(For, {
          get each() {
            return props.state?.servers ?? [];
          },
          get fallback() {
            return getNextElement(_tmpl$3);
          },
          children: (srv) => createComponent(ServerListItem, mergeProps(props, {
            server: srv
          }))
        }));
        return _el$4;
      }
    }), _el$6, _co$);
    return _el$;
  })();
}
function AddServerForm(props) {
  const [addServer, setAddServer] = createStore({
    port: 1890,
    host: "127.0.0.1",
    displayName: ""
  });
  return (() => {
    var _el$0 = getNextElement(_tmpl$4), _el$1 = _el$0.firstChild, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$1.nextSibling, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, [_el$15, _co$3] = getNextMarker(_el$14.nextSibling);
    insert(_el$10, createComponent(InputField, {
      label: "Port",
      type: "number",
      min: 0,
      max: 65535,
      value: 1890,
      onChange: (e) => setAddServer("port", Number(e.target.value))
    }));
    insert(_el$11, createComponent(InputField, {
      label: "Host (Optional)",
      placeholder: "127.0.0.1",
      onChange: (e) => setAddServer("host", e.target.value)
    }));
    insert(_el$13, createComponent(InputField, {
      label: "Display Name (Optional)",
      value: "",
      placeholder: "My Server",
      onChange: (e) => setAddServer("displayName", e.target.value)
    }));
    insert(_el$12, createComponent(EffectButton, {
      onClick: () => props.rpc.StartServer({
        port: addServer.port,
        host: addServer.host || "127.0.0.1",
        displayName: addServer.displayName || void 0
      }),
      children: "Start Server"
    }), _el$15, _co$3);
    return _el$0;
  })();
}
function ServerListItem(props) {
  const server = () => props.server;
  const hasDisplayName = () => !!server().displayName;
  return (() => {
    var _el$16 = getNextElement(_tmpl$5), _el$17 = _el$16.firstChild, _el$18 = _el$17.firstChild, _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling, [_el$21, _co$4] = getNextMarker(_el$20.nextSibling), _el$22 = _el$18.nextSibling, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$24.firstChild, [_el$26, _co$5] = getNextMarker(_el$25.nextSibling), _el$27 = _el$26.nextSibling, [_el$28, _co$6] = getNextMarker(_el$27.nextSibling), _el$29 = _el$17.nextSibling, _el$30 = _el$29.firstChild, [_el$31, _co$7] = getNextMarker(_el$30.nextSibling), _el$32 = _el$31.nextSibling, [_el$33, _co$8] = getNextMarker(_el$32.nextSibling);
    insert(_el$19, () => server().displayName ?? `Port ${server().port}`);
    insert(_el$18, (() => {
      var _c$ = memo(() => !!hasDisplayName());
      return () => _c$() && (() => {
        var _el$34 = getNextElement(_tmpl$6), _el$35 = _el$34.firstChild, _el$37 = _el$35.nextSibling, [_el$38, _co$9] = getNextMarker(_el$37.nextSibling);
        _el$38.nextSibling;
        insert(_el$34, () => server().port, _el$38, _co$9);
        return _el$34;
      })();
    })(), _el$21, _co$4);
    insert(_el$24, () => SERVER_STATE_INDICATOR[server().state].label, _el$26, _co$5);
    insert(_el$24, (() => {
      var _c$2 = memo(() => server().state === "running");
      return () => _c$2() && ` (${server().clientCount} ${server().clientCount === 1 ? "client" : "clients"})`;
    })(), _el$28, _co$6);
    insert(_el$29, createComponent(EffectButton, {
      variant: "text",
      onClick: () => server().state === "running" ? props.rpc.StopServer({
        port: server().port
      }) : props.rpc.StartServer({
        port: server().port,
        host: server().host,
        displayName: server().displayName
      }),
      get children() {
        return server().state === "running" ? "Stop" : "Start";
      }
    }), _el$31, _co$7);
    insert(_el$29, createComponent(EffectButton, {
      variant: "textDanger",
      onClick: () => props.rpc.RemoveServer({
        port: server().port
      }),
      children: "Remove"
    }), _el$33, _co$8);
    createRenderEffect(() => className(_el$23, cx("size-2 rounded-full", SERVER_STATE_INDICATOR[server().state].class)));
    return _el$16;
  })();
}
function InputField(props) {
  const [labelProps, inputProps] = splitProps(props, ["label"]);
  const id = createUniqueId();
  return (() => {
    var _el$39 = getNextElement(_tmpl$7), _el$40 = _el$39.firstChild, _el$41 = _el$40.nextSibling;
    setAttribute(_el$40, "for", id);
    insert(_el$40, () => labelProps.label);
    setAttribute(_el$41, "id", id);
    spread(_el$41, inputProps, false, false);
    runHydrationEvents();
    return _el$39;
  })();
}
const Rpcs = ClientRpcs;
export {
  Rpcs,
  Settings as default
};
