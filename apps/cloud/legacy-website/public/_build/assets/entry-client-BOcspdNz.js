const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["_build/assets/DesktopListener-xEv-s2g7.js","_build/assets/web-Dl2sEcME.js","_build/assets/solid-COykZtSy.js","_build/assets/index-Canl0i0r.js","_build/assets/R5675YMU-C6EXqLl_.js","_build/assets/index-Dic9SOHc.js","_build/assets/store-12zX8qse.js","_build/assets/api-BeJqlYcr.js","_build/assets/action-DEY4sCLp.js","_build/assets/routing-KR3q6KJw.js","_build/assets/button-dTk4F7f6.js","_build/assets/account-BpJ1Q5oP.js","_build/assets/preload-helper-DPb_hSpc.js","_build/assets/clientOnly-D2mHZ0MZ.js","_build/assets/Logo-rCe3USwQ.js","_build/assets/Forms-t1wWmU5a.js","_build/assets/input-3faxl7mS.js","_build/assets/createAsync-DflW-LI1.js","_build/assets/dropdown-menu-LCNp2cQP.js","_build/assets/ZUHR2BAH-DciGzthU.js","_build/assets/dialog-Cl8aIpB7.js","_build/assets/components-CTFPIzrW.js","_build/assets/credentials-DRct5CcR.js","_build/assets/server-registration-B4M5I0F3.js","_build/assets/App Logo-Cw4Q4SY2.js","_build/assets/signup-D193fg_z.js","_build/assets/index-BcgxK-X6.js","_build/assets/index-DD6zvG81.js","_build/assets/Editor-BKmruR4M.js","_build/assets/round-share-4IwrIuPI.js","_build/assets/dots-horizontal-ZGk_uH4H.js","_build/assets/json-ZCfGR0vq.js","_build/assets/round-share-C11yF8C2.css","_build/assets/index-9L8vuTyG.js","_build/assets/index-Bo77jTwT.js","_build/assets/index-BRDWZEOv.css","_build/assets/credentials-DQVTotoR.js","_build/assets/servers-CB1ZstRH.js","_build/assets/device-D9BiR57S.js","_build/assets/index-BEy4ZqjN.js","_build/assets/DesktopListener-BTh0vXIO.js"])))=>i.map(i=>d[i]);
import { m as memo, d as delegateEvents, g as getNextElement, t as template, i as insert$1, r as render } from "./web-Dl2sEcME.js";
import { _ as __vitePreload } from "./preload-helper-DPb_hSpc.js";
import { M as MetaProvider, T as Title } from "./index-Bo77jTwT.js";
import { c as clientOnly } from "./clientOnly-D2mHZ0MZ.js";
import { c as children, a as createMemo, b as createComponent, g as getOwner, u as untrack, S as Show, o as on, d as createRoot, e as createSignal, f as onCleanup, s as sharedConfig, l as lazy, h as Suspense, E as ErrorBoundary$1 } from "./solid-COykZtSy.js";
import { T as Toaster } from "./index-Dic9SOHc.js";
import { c as createBranches, a as createRouterContext, R as RouterContextObj, s as setInPreloadFn, g as getIntent, b as createRouteContext, d as RouteContextObj, m as mockBase, e as createBeforeLeave, k as keepDepth, f as saveCurrentDepth, n as notifyIfNotBlocked } from "./routing-KR3q6KJw.js";
import { a as actions } from "./action-DEY4sCLp.js";
import "./store-12zX8qse.js";
const createRouterComponent = (router) => (props) => {
  const {
    base
  } = props;
  const routeDefs = children(() => props.children);
  const branches = createMemo(() => createBranches(routeDefs(), props.base || ""));
  let context;
  const routerState = createRouterContext(router, branches, () => context, {
    base,
    singleFlight: props.singleFlight,
    transformUrl: props.transformUrl
  });
  router.create && router.create(routerState);
  return createComponent(RouterContextObj.Provider, {
    value: routerState,
    get children() {
      return createComponent(Root, {
        routerState,
        get root() {
          return props.root;
        },
        get preload() {
          return props.rootPreload || props.rootLoad;
        },
        get children() {
          return [memo(() => (context = getOwner()) && null), createComponent(Routes, {
            routerState,
            get branches() {
              return branches();
            }
          })];
        }
      });
    }
  });
};
function Root(props) {
  const location = props.routerState.location;
  const params = props.routerState.params;
  const data = createMemo(() => props.preload && untrack(() => {
    setInPreloadFn(true);
    props.preload({
      params,
      location,
      intent: getIntent() || "initial"
    });
    setInPreloadFn(false);
  }));
  return createComponent(Show, {
    get when() {
      return props.root;
    },
    keyed: true,
    get fallback() {
      return props.children;
    },
    children: (Root2) => createComponent(Root2, {
      params,
      location,
      get data() {
        return data();
      },
      get children() {
        return props.children;
      }
    })
  });
}
function Routes(props) {
  const disposers = [];
  let root;
  const routeStates = createMemo(on(props.routerState.matches, (nextMatches, prevMatches, prev) => {
    let equal = prevMatches && nextMatches.length === prevMatches.length;
    const next = [];
    for (let i = 0, len = nextMatches.length; i < len; i++) {
      const prevMatch = prevMatches && prevMatches[i];
      const nextMatch = nextMatches[i];
      if (prev && prevMatch && nextMatch.route.key === prevMatch.route.key) {
        next[i] = prev[i];
      } else {
        equal = false;
        if (disposers[i]) {
          disposers[i]();
        }
        createRoot((dispose) => {
          disposers[i] = dispose;
          next[i] = createRouteContext(props.routerState, next[i - 1] || props.routerState.base, createOutlet(() => routeStates()[i + 1]), () => props.routerState.matches()[i]);
        });
      }
    }
    disposers.splice(nextMatches.length).forEach((dispose) => dispose());
    if (prev && equal) {
      return prev;
    }
    root = next[0];
    return next;
  }));
  return createOutlet(() => routeStates() && root)();
}
const createOutlet = (child) => {
  return () => createComponent(Show, {
    get when() {
      return child();
    },
    keyed: true,
    children: (child2) => createComponent(RouteContextObj.Provider, {
      value: child2,
      get children() {
        return child2.outlet();
      }
    })
  });
};
function intercept([value, setValue], get, set) {
  return [value, set ? (v) => setValue(set(v)) : setValue];
}
function createRouter$1(config) {
  let ignore = false;
  const wrap = (value) => typeof value === "string" ? {
    value
  } : value;
  const signal = intercept(createSignal(wrap(config.get()), {
    equals: (a, b) => a.value === b.value && a.state === b.state
  }), void 0, (next) => {
    !ignore && config.set(next);
    if (sharedConfig.registry && !sharedConfig.done) sharedConfig.done = true;
    return next;
  });
  config.init && onCleanup(config.init((value = config.get()) => {
    ignore = true;
    signal[1](wrap(value));
    ignore = false;
  }));
  return createRouterComponent({
    signal,
    create: config.create,
    utils: config.utils
  });
}
function bindEvent(target, type, handler) {
  target.addEventListener(type, handler);
  return () => target.removeEventListener(type, handler);
}
function scrollToHash(hash, fallbackTop) {
  const el = hash && document.getElementById(hash);
  if (el) {
    el.scrollIntoView();
  } else if (fallbackTop) {
    window.scrollTo(0, 0);
  }
}
function setupNativeEvents(preload = true, explicitLinks = false, actionBase = "/_server", transformUrl) {
  return (router) => {
    const basePath = router.base.path();
    const navigateFromRoute = router.navigatorFactory(router.base);
    let preloadTimeout;
    let lastElement;
    function isSvg(el) {
      return el.namespaceURI === "http://www.w3.org/2000/svg";
    }
    function handleAnchor(evt) {
      if (evt.defaultPrevented || evt.button !== 0 || evt.metaKey || evt.altKey || evt.ctrlKey || evt.shiftKey) return;
      const a = evt.composedPath().find((el) => el instanceof Node && el.nodeName.toUpperCase() === "A");
      if (!a || explicitLinks && !a.hasAttribute("link")) return;
      const svg = isSvg(a);
      const href = svg ? a.href.baseVal : a.href;
      const target = svg ? a.target.baseVal : a.target;
      if (target || !href && !a.hasAttribute("state")) return;
      const rel = (a.getAttribute("rel") || "").split(/\s+/);
      if (a.hasAttribute("download") || rel && rel.includes("external")) return;
      const url = svg ? new URL(href, document.baseURI) : new URL(href);
      if (url.origin !== window.location.origin || basePath && url.pathname && !url.pathname.toLowerCase().startsWith(basePath.toLowerCase())) return;
      return [a, url];
    }
    function handleAnchorClick(evt) {
      const res = handleAnchor(evt);
      if (!res) return;
      const [a, url] = res;
      const to = router.parsePath(url.pathname + url.search + url.hash);
      const state = a.getAttribute("state");
      evt.preventDefault();
      navigateFromRoute(to, {
        resolve: false,
        replace: a.hasAttribute("replace"),
        scroll: !a.hasAttribute("noscroll"),
        state: state ? JSON.parse(state) : void 0
      });
    }
    function handleAnchorPreload(evt) {
      const res = handleAnchor(evt);
      if (!res) return;
      const [a, url] = res;
      transformUrl && (url.pathname = transformUrl(url.pathname));
      router.preloadRoute(url, a.getAttribute("preload") !== "false");
    }
    function handleAnchorMove(evt) {
      clearTimeout(preloadTimeout);
      const res = handleAnchor(evt);
      if (!res) return lastElement = null;
      const [a, url] = res;
      if (lastElement === a) return;
      transformUrl && (url.pathname = transformUrl(url.pathname));
      preloadTimeout = setTimeout(() => {
        router.preloadRoute(url, a.getAttribute("preload") !== "false");
        lastElement = a;
      }, 20);
    }
    function handleFormSubmit(evt) {
      if (evt.defaultPrevented) return;
      let actionRef = evt.submitter && evt.submitter.hasAttribute("formaction") ? evt.submitter.getAttribute("formaction") : evt.target.getAttribute("action");
      if (!actionRef) return;
      if (!actionRef.startsWith("https://action/")) {
        const url = new URL(actionRef, mockBase);
        actionRef = router.parsePath(url.pathname + url.search);
        if (!actionRef.startsWith(actionBase)) return;
      }
      if (evt.target.method.toUpperCase() !== "POST") throw new Error("Only POST forms are supported for Actions");
      const handler = actions.get(actionRef);
      if (handler) {
        evt.preventDefault();
        const data = new FormData(evt.target, evt.submitter);
        handler.call({
          r: router,
          f: evt.target
        }, evt.target.enctype === "multipart/form-data" ? data : new URLSearchParams(data));
      }
    }
    delegateEvents(["click", "submit"]);
    document.addEventListener("click", handleAnchorClick);
    if (preload) {
      document.addEventListener("mousemove", handleAnchorMove, {
        passive: true
      });
      document.addEventListener("focusin", handleAnchorPreload, {
        passive: true
      });
      document.addEventListener("touchstart", handleAnchorPreload, {
        passive: true
      });
    }
    document.addEventListener("submit", handleFormSubmit);
    onCleanup(() => {
      document.removeEventListener("click", handleAnchorClick);
      if (preload) {
        document.removeEventListener("mousemove", handleAnchorMove);
        document.removeEventListener("focusin", handleAnchorPreload);
        document.removeEventListener("touchstart", handleAnchorPreload);
      }
      document.removeEventListener("submit", handleFormSubmit);
    });
  };
}
function Router(props) {
  const getSource = () => {
    const url = window.location.pathname.replace(/^\/+/, "/") + window.location.search;
    const state = window.history.state && window.history.state._depth && Object.keys(window.history.state).length === 1 ? void 0 : window.history.state;
    return {
      value: url + window.location.hash,
      state
    };
  };
  const beforeLeave = createBeforeLeave();
  return createRouter$1({
    get: getSource,
    set({
      value,
      replace,
      scroll,
      state
    }) {
      if (replace) {
        window.history.replaceState(keepDepth(state), "", value);
      } else {
        window.history.pushState(state, "", value);
      }
      scrollToHash(decodeURIComponent(window.location.hash.slice(1)), scroll);
      saveCurrentDepth();
    },
    init: (notify) => bindEvent(window, "popstate", notifyIfNotBlocked(notify, (delta) => {
      if (delta && delta < 0) {
        return !beforeLeave.confirm(delta);
      } else {
        const s = getSource();
        return !beforeLeave.confirm(s.value, {
          state: s.state
        });
      }
    })),
    create: setupNativeEvents(props.preload, props.explicitLinks, props.actionBase, props.transformUrl),
    utils: {
      go: (delta) => window.history.go(delta),
      beforeLeave
    }
  })(props);
}
const HttpStatusCode = (_props) => null;
const fileRoutes = [{ "page": true, "$component": { "src": "src/app/DesktopListener.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./DesktopListener-xEv-s2g7.js"
), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./DesktopListener-xEv-s2g7.js"
), true ? __vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10]) : void 0) }, "path": "/DesktopListener" }, { "page": true, "$component": { "src": "src/app/(app)/account.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./account-BpJ1Q5oP.js"
), true ? __vite__mapDeps([11,12,1,2,13,14,5,6,7,8,9,15,16,10,17,18,19,4,20,21]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./account-BpJ1Q5oP.js"
), true ? __vite__mapDeps([11,12,1,2,13,14,5,6,7,8,9,15,16,10,17,18,19,4,20,21]) : void 0) }, "path": "/(app)/account" }, { "page": true, "$component": { "src": "src/app/(app)/credentials.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./credentials-DRct5CcR.js"
), true ? __vite__mapDeps([22,2,21,1,9]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./credentials-DRct5CcR.js"
), true ? __vite__mapDeps([22,2,21,1,9]) : void 0) }, "path": "/(app)/credentials" }, { "page": true, "$component": { "src": "src/app/(auth)/server-registration.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./server-registration-B4M5I0F3.js"
), true ? __vite__mapDeps([23,1,2,7,8,9,24,17,10]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./server-registration-B4M5I0F3.js"
), true ? __vite__mapDeps([23,1,2,7,8,9,24,17,10]) : void 0) }, "path": "/(auth)/server-registration" }, { "page": true, "$component": { "src": "src/app/(auth)/signup.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./signup-D193fg_z.js"
), true ? __vite__mapDeps([25,15,1,2,7,8,9,16,10]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./signup-D193fg_z.js"
), true ? __vite__mapDeps([25,15,1,2,7,8,9,16,10]) : void 0) }, "path": "/(auth)/signup" }, { "page": true, "$component": { "src": "src/app/(landing)/index.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./index-BcgxK-X6.js"
), true ? __vite__mapDeps([26,12,1,2,13,24,14,5,6,7,8,9,15,16,10,17,18,19,4,20]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./index-BcgxK-X6.js"
), true ? __vite__mapDeps([26,12,1,2,13,24,14,5,6,7,8,9,15,16,10,17,18,19,4,20]) : void 0) }, "path": "/(landing)/" }, { "page": true, "$component": { "src": "src/app/new-playground/index.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./index-DD6zvG81.js"
), true ? __vite__mapDeps([27,12,13,2]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./index-DD6zvG81.js"
), true ? __vite__mapDeps([27,12,13,2]) : void 0) }, "path": "/new-playground/" }, { "page": true, "$component": { "src": "src/app/playground/Editor.tsx?pick=ConnectionsDialogButton&pick=ExportButton&pick=ProjectName&pick=ShareButton&pick=api&pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./Editor-BKmruR4M.js"
), true ? __vite__mapDeps([28,1,2,29,20,10,19,4,30,3,6,5,12,31,17,32,7,8,9]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./Editor-BKmruR4M.js"
), true ? __vite__mapDeps([28,1,2,29,20,10,19,4,30,3,6,5,12,31,17,32,7,8,9]) : void 0) }, "path": "/playground/Editor" }, { "page": true, "$component": { "src": "src/app/playground/index.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./index-9L8vuTyG.js"
), true ? __vite__mapDeps([33,12,1,2,13,34,14,5,6,7,8,9,15,16,10,17,18,19,4,20,35]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./index-9L8vuTyG.js"
), true ? __vite__mapDeps([33,12,1,2,13,34,14,5,6,7,8,9,15,16,10,17,18,19,4,20,35]) : void 0) }, "path": "/playground/" }, { "page": true, "$component": { "src": "src/app/(app)/account/credentials.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./credentials-DQVTotoR.js"
), true ? __vite__mapDeps([36,1,2,5,6,7,8,9,18,10,19,4,17]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./credentials-DQVTotoR.js"
), true ? __vite__mapDeps([36,1,2,5,6,7,8,9,18,10,19,4,17]) : void 0) }, "path": "/(app)/account/credentials" }, { "page": true, "$component": { "src": "src/app/(app)/account/servers.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./servers-CB1ZstRH.js"
), true ? __vite__mapDeps([37,1,2,7,8,9,17]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./servers-CB1ZstRH.js"
), true ? __vite__mapDeps([37,1,2,7,8,9,17]) : void 0) }, "path": "/(app)/account/servers" }, { "page": true, "$component": { "src": "src/app/(auth)/login/device.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./device-D9BiR57S.js"
), true ? __vite__mapDeps([38,1,2,7,8,9,24,17,10]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./device-D9BiR57S.js"
), true ? __vite__mapDeps([38,1,2,7,8,9,24,17,10]) : void 0) }, "path": "/(auth)/login/device" }, { "page": true, "$component": { "src": "src/app/(auth)/login/index.tsx?pick=default&pick=$css", "build": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./index-BEy4ZqjN.js"
), true ? __vite__mapDeps([39,15,1,2,7,8,9,16,10]) : void 0), "import": () => __vitePreload(() => import(
  /* @vite-ignore */
  "./index-BEy4ZqjN.js"
), true ? __vite__mapDeps([39,15,1,2,7,8,9,16,10]) : void 0) }, "path": "/(auth)/login/" }];
const NODE_TYPES = {
  NORMAL: 0,
  WILDCARD: 1,
  PLACEHOLDER: 2
};
function createRouter(options = {}) {
  const ctx = {
    options,
    rootNode: createRadixNode(),
    staticRoutesMap: {}
  };
  const normalizeTrailingSlash = (p) => options.strictTrailingSlash ? p : p.replace(/\/$/, "") || "/";
  if (options.routes) {
    for (const path in options.routes) {
      insert(ctx, normalizeTrailingSlash(path), options.routes[path]);
    }
  }
  return {
    ctx,
    lookup: (path) => lookup(ctx, normalizeTrailingSlash(path)),
    insert: (path, data) => insert(ctx, normalizeTrailingSlash(path), data),
    remove: (path) => remove(ctx, normalizeTrailingSlash(path))
  };
}
function lookup(ctx, path) {
  const staticPathNode = ctx.staticRoutesMap[path];
  if (staticPathNode) {
    return staticPathNode.data;
  }
  const sections = path.split("/");
  const params = {};
  let paramsFound = false;
  let wildcardNode = null;
  let node = ctx.rootNode;
  let wildCardParam = null;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (node.wildcardChildNode !== null) {
      wildcardNode = node.wildcardChildNode;
      wildCardParam = sections.slice(i).join("/");
    }
    const nextNode = node.children.get(section);
    if (nextNode === void 0) {
      if (node && node.placeholderChildren.length > 1) {
        const remaining = sections.length - i;
        node = node.placeholderChildren.find((c) => c.maxDepth === remaining) || null;
      } else {
        node = node.placeholderChildren[0] || null;
      }
      if (!node) {
        break;
      }
      if (node.paramName) {
        params[node.paramName] = section;
      }
      paramsFound = true;
    } else {
      node = nextNode;
    }
  }
  if ((node === null || node.data === null) && wildcardNode !== null) {
    node = wildcardNode;
    params[node.paramName || "_"] = wildCardParam;
    paramsFound = true;
  }
  if (!node) {
    return null;
  }
  if (paramsFound) {
    return {
      ...node.data,
      params: paramsFound ? params : void 0
    };
  }
  return node.data;
}
function insert(ctx, path, data) {
  let isStaticRoute = true;
  const sections = path.split("/");
  let node = ctx.rootNode;
  let _unnamedPlaceholderCtr = 0;
  const matchedNodes = [node];
  for (const section of sections) {
    let childNode;
    if (childNode = node.children.get(section)) {
      node = childNode;
    } else {
      const type = getNodeType(section);
      childNode = createRadixNode({ type, parent: node });
      node.children.set(section, childNode);
      if (type === NODE_TYPES.PLACEHOLDER) {
        childNode.paramName = section === "*" ? `_${_unnamedPlaceholderCtr++}` : section.slice(1);
        node.placeholderChildren.push(childNode);
        isStaticRoute = false;
      } else if (type === NODE_TYPES.WILDCARD) {
        node.wildcardChildNode = childNode;
        childNode.paramName = section.slice(
          3
          /* "**:" */
        ) || "_";
        isStaticRoute = false;
      }
      matchedNodes.push(childNode);
      node = childNode;
    }
  }
  for (const [depth, node2] of matchedNodes.entries()) {
    node2.maxDepth = Math.max(matchedNodes.length - depth, node2.maxDepth || 0);
  }
  node.data = data;
  if (isStaticRoute === true) {
    ctx.staticRoutesMap[path] = node;
  }
  return node;
}
function remove(ctx, path) {
  let success = false;
  const sections = path.split("/");
  let node = ctx.rootNode;
  for (const section of sections) {
    node = node.children.get(section);
    if (!node) {
      return success;
    }
  }
  if (node.data) {
    const lastSection = sections.at(-1) || "";
    node.data = null;
    if (Object.keys(node.children).length === 0 && node.parent) {
      node.parent.children.delete(lastSection);
      node.parent.wildcardChildNode = null;
      node.parent.placeholderChildren = [];
    }
    success = true;
  }
  return success;
}
function createRadixNode(options = {}) {
  return {
    type: options.type || NODE_TYPES.NORMAL,
    maxDepth: 0,
    parent: options.parent || null,
    children: /* @__PURE__ */ new Map(),
    data: options.data || null,
    paramName: options.paramName || null,
    wildcardChildNode: null,
    placeholderChildren: []
  };
}
function getNodeType(str) {
  if (str.startsWith("**")) {
    return NODE_TYPES.WILDCARD;
  }
  if (str[0] === ":" || str === "*") {
    return NODE_TYPES.PLACEHOLDER;
  }
  return NODE_TYPES.NORMAL;
}
const pageRoutes = defineRoutes(fileRoutes.filter((o) => o.page));
function defineRoutes(fileRoutes2) {
  function processRoute(routes2, route, id, full) {
    const parentRoute = Object.values(routes2).find((o) => {
      return id.startsWith(o.id + "/");
    });
    if (!parentRoute) {
      routes2.push({
        ...route,
        id,
        path: id.replace(/\([^)/]+\)/g, "").replace(/\/+/g, "/")
      });
      return routes2;
    }
    processRoute(parentRoute.children || (parentRoute.children = []), route, id.slice(parentRoute.id.length));
    return routes2;
  }
  return fileRoutes2.sort((a, b) => a.path.length - b.path.length).reduce((prevRoutes, route) => {
    return processRoute(prevRoutes, route, route.path, route.path);
  }, []);
}
createRouter({
  routes: fileRoutes.reduce((memo2, route) => {
    if (!containsHTTP(route)) return memo2;
    const path = route.path.replace(/\([^)/]+\)/g, "").replace(/\/+/g, "/").replace(/\*([^/]*)/g, (_, m) => `**:${m}`).split("/").map((s) => s.startsWith(":") || s.startsWith("*") ? s : encodeURIComponent(s)).join("/");
    if (/:[^/]*\?/g.test(path)) {
      throw new Error(`Optional parameters are not supported in API routes: ${path}`);
    }
    if (memo2[path]) {
      throw new Error(`Duplicate API routes for "${path}" found at "${memo2[path].route.path}" and "${route.path}"`);
    }
    memo2[path] = {
      route
    };
    return memo2;
  }, {})
});
function containsHTTP(route) {
  return route["$HEAD"] || route["$GET"] || route["$POST"] || route["$PUT"] || route["$PATCH"] || route["$DELETE"];
}
const components = {};
function createRoutes() {
  function createRoute(route) {
    const component = route.$component && (components[route.$component.src] ??= lazy(route.$component.import));
    return {
      ...route,
      ...route.$$route ? route.$$route.require().route : void 0,
      info: {
        ...route.$$route ? route.$$route.require().route.info : {},
        filesystem: true
      },
      component,
      children: route.children ? route.children.map(createRoute) : void 0
    };
  }
  const routes2 = pageRoutes.map(createRoute);
  return routes2;
}
let routes;
const FileRoutes = () => routes || (routes = createRoutes());
const DesktopListener = clientOnly(() => __vitePreload(() => import("./DesktopListener-BTh0vXIO.js"), true ? __vite__mapDeps([40,1,2,3,4,5,6,7,8,9,10]) : void 0));
function App() {
  return createComponent(Router, {
    root: (props) => createComponent(MetaProvider, {
      get children() {
        return [createComponent(Title, {
          children: "MacroGraph"
        }), createComponent(Suspense, {
          get children() {
            return props.children;
          }
        }), createComponent(ErrorBoundary$1, {
          fallback: null,
          get children() {
            return createComponent(DesktopListener, {});
          }
        }), createComponent(Toaster, {})];
      }
    }),
    get children() {
      return createComponent(FileRoutes, {});
    }
  });
}
var _tmpl$ = /* @__PURE__ */ template(`<span style=font-size:1.5em;text-align:center;position:fixed;left:0px;bottom:55%;width:100%>`);
const ErrorBoundary = (props) => {
  const message = "Error | Uncaught Client Exception";
  return createComponent(ErrorBoundary$1, {
    fallback: (error) => {
      console.error(error);
      return [(() => {
        var _el$ = getNextElement(_tmpl$);
        insert$1(_el$, message);
        return _el$;
      })(), createComponent(HttpStatusCode, {
        code: 500
      })];
    },
    get children() {
      return props.children;
    }
  });
};
function Dummy(props) {
  return props.children;
}
function StartClient() {
  return createComponent(Dummy, {
    get children() {
      return createComponent(Dummy, {
        get children() {
          return createComponent(ErrorBoundary, {
            get children() {
              return createComponent(App, {});
            }
          });
        }
      });
    }
  });
}
render(() => createComponent(StartClient, {}), document.getElementById("app"));
