import { w as getListener, f as onCleanup, s as sharedConfig, e as createSignal, x as startTransition, g as getOwner, a as createMemo, $ as $TRACK } from "./solid-COykZtSy.js";
import { l as useNavigate, g as getIntent, p as getInPreloadFn, q as useRouter, m as mockBase } from "./routing-DEHGCM-R.js";
import { k as isServer } from "./web-BrXyZ-Hv.js";
const LocationHeader = "Location";
const PRELOAD_TIMEOUT = 5e3;
const CACHE_TIMEOUT = 18e4;
let cacheMap = /* @__PURE__ */ new Map();
{
  setInterval(() => {
    const now = Date.now();
    for (let [k, v] of cacheMap.entries()) {
      if (!v[4].count && now - v[0] > CACHE_TIMEOUT) {
        cacheMap.delete(k);
      }
    }
  }, 3e5);
}
function getCache() {
  return cacheMap;
}
function revalidate(key, force = true) {
  return startTransition(() => {
    const now = Date.now();
    cacheKeyOp(key, (entry) => {
      force && (entry[0] = 0);
      entry[4][1](now);
    });
  });
}
function cacheKeyOp(key, fn) {
  key && !Array.isArray(key) && (key = [key]);
  for (let k of cacheMap.keys()) {
    if (key === void 0 || matchKey(k, key)) fn(cacheMap.get(k));
  }
}
function query(fn, name) {
  if (fn.GET) fn = fn.GET;
  const cachedFn = (...args) => {
    const cache2 = getCache();
    const intent = getIntent();
    const inPreloadFn = getInPreloadFn();
    const owner = getOwner();
    const navigate = owner ? useNavigate() : void 0;
    const now = Date.now();
    const key = name + hashKey(args);
    let cached = cache2.get(key);
    let tracking;
    if (getListener() && !isServer) {
      tracking = true;
      onCleanup(() => cached[4].count--);
    }
    if (cached && cached[0] && (intent === "native" || cached[4].count || Date.now() - cached[0] < PRELOAD_TIMEOUT)) {
      if (tracking) {
        cached[4].count++;
        cached[4][0]();
      }
      if (cached[3] === "preload" && intent !== "preload") {
        cached[0] = now;
      }
      let res2 = cached[1];
      if (intent !== "preload") {
        res2 = "then" in cached[1] ? cached[1].then(handleResponse2(false), handleResponse2(true)) : handleResponse2(false)(cached[1]);
        intent === "navigate" && startTransition(() => cached[4][1](cached[0]));
      }
      inPreloadFn && "then" in res2 && res2.catch(() => {
      });
      return res2;
    }
    let res;
    if (sharedConfig.has && sharedConfig.has(key)) {
      res = sharedConfig.load(key);
      delete globalThis._$HY.r[key];
    } else res = fn(...args);
    if (cached) {
      cached[0] = now;
      cached[1] = res;
      cached[3] = intent;
      intent === "navigate" && startTransition(() => cached[4][1](cached[0]));
    } else {
      cache2.set(key, cached = [now, res, , intent, createSignal(now)]);
      cached[4].count = 0;
    }
    if (tracking) {
      cached[4].count++;
      cached[4][0]();
    }
    if (intent !== "preload") {
      res = "then" in res ? res.then(handleResponse2(false), handleResponse2(true)) : handleResponse2(false)(res);
    }
    inPreloadFn && "then" in res && res.catch(() => {
    });
    return res;
    function handleResponse2(error) {
      return async (v) => {
        if (v instanceof Response) {
          const url = v.headers.get(LocationHeader);
          if (url !== null) {
            if (navigate && url.startsWith("/")) startTransition(() => {
              navigate(url, {
                replace: true
              });
            });
            else window.location.href = url;
            return;
          }
          if (v.customBody) v = await v.customBody();
        }
        if (error) throw v;
        cached[2] = v;
        return v;
      };
    }
  };
  cachedFn.keyFor = (...args) => name + hashKey(args);
  cachedFn.key = name;
  return cachedFn;
}
query.get = (key) => {
  const cached = getCache().get(key);
  return cached[2];
};
query.set = (key, value) => {
  const cache2 = getCache();
  const now = Date.now();
  let cached = cache2.get(key);
  if (cached) {
    cached[0] = now;
    cached[1] = Promise.resolve(value);
    cached[2] = value;
    cached[3] = "preload";
  } else {
    cache2.set(key, cached = [now, Promise.resolve(value), value, "preload", createSignal(now)]);
    cached[4].count = 0;
  }
};
query.delete = (key) => getCache().delete(key);
query.clear = () => getCache().clear();
const cache = query;
function matchKey(key, keys) {
  for (let k of keys) {
    if (k && key.startsWith(k)) return true;
  }
  return false;
}
function hashKey(args) {
  return JSON.stringify(args, (_, val) => isPlainObject(val) ? Object.keys(val).sort().reduce((result, key) => {
    result[key] = val[key];
    return result;
  }, {}) : val);
}
function isPlainObject(obj) {
  let proto;
  return obj != null && typeof obj === "object" && (!(proto = Object.getPrototypeOf(obj)) || proto === Object.prototype);
}
const actions = /* @__PURE__ */ new Map();
function useSubmissions(fn, filter) {
  const router = useRouter();
  const subs = createMemo(() => router.submissions[0]().filter((s) => s.url === fn.base && (!filter || filter(s.input))));
  return new Proxy([], {
    get(_, property) {
      if (property === $TRACK) return subs();
      if (property === "pending") return subs().some((sub) => !sub.result);
      return subs()[property];
    },
    has(_, property) {
      return property in subs();
    }
  });
}
function useSubmission(fn, filter) {
  const submissions = useSubmissions(fn, filter);
  return new Proxy({}, {
    get(_, property) {
      if (submissions.length === 0 && property === "clear" || property === "retry") return () => {
      };
      return submissions[submissions.length - 1]?.[property];
    }
  });
}
function useAction(action2) {
  const r = useRouter();
  return (...args) => action2.apply({
    r
  }, args);
}
function action(fn, options = {}) {
  function mutate(...variables) {
    const router = this.r;
    const form = this.f;
    const p = (router.singleFlight && fn.withOptions ? fn.withOptions({
      headers: {
        "X-Single-Flight": "true"
      }
    }) : fn)(...variables);
    const [result, setResult] = createSignal();
    let submission;
    function handler(error) {
      return async (res) => {
        const result2 = await handleResponse(res, error, router.navigatorFactory());
        let retry = null;
        o.onComplete?.({
          ...submission,
          result: result2?.data,
          error: result2?.error,
          pending: false,
          retry() {
            return retry = submission.retry();
          }
        });
        if (retry) return retry;
        if (!result2) return submission.clear();
        setResult(result2);
        if (result2.error && !form) throw result2.error;
        return result2.data;
      };
    }
    router.submissions[1]((s) => [...s, submission = {
      input: variables,
      url,
      get result() {
        return result()?.data;
      },
      get error() {
        return result()?.error;
      },
      get pending() {
        return !result();
      },
      clear() {
        router.submissions[1]((v) => v.filter((i) => i !== submission));
      },
      retry() {
        setResult(void 0);
        const p2 = fn(...variables);
        return p2.then(handler(), handler(true));
      }
    }]);
    return p.then(handler(), handler(true));
  }
  const o = typeof options === "string" ? {
    name: options
  } : options;
  const url = fn.url || o.name && `https://action/${o.name}` || `https://action/${hashString(fn.toString())}`;
  mutate.base = url;
  return toAction(mutate, url);
}
function toAction(fn, url) {
  fn.toString = () => {
    if (!url) throw new Error("Client Actions need explicit names if server rendered");
    return url;
  };
  fn.with = function(...args) {
    const newFn = function(...passedArgs) {
      return fn.call(this, ...args, ...passedArgs);
    };
    newFn.base = fn.base;
    const uri = new URL(url, mockBase);
    uri.searchParams.set("args", hashKey(args));
    return toAction(newFn, (uri.origin === "https://action" ? uri.origin : "") + uri.pathname + uri.search);
  };
  fn.url = url;
  {
    actions.set(url, fn);
    getOwner() && onCleanup(() => actions.delete(url));
  }
  return fn;
}
const hashString = (s) => s.split("").reduce((a, b) => (a << 5) - a + b.charCodeAt(0) | 0, 0);
async function handleResponse(response, error, navigate) {
  let data;
  let custom;
  let keys;
  let flightKeys;
  if (response instanceof Response) {
    if (response.headers.has("X-Revalidate")) keys = response.headers.get("X-Revalidate").split(",");
    if (response.customBody) {
      data = custom = await response.customBody();
      if (response.headers.has("X-Single-Flight")) {
        data = data._$value;
        delete custom._$value;
        flightKeys = Object.keys(custom);
      }
    }
    if (response.headers.has("Location")) {
      const locationUrl = response.headers.get("Location") || "/";
      if (locationUrl.startsWith("http")) {
        window.location.href = locationUrl;
      } else {
        navigate(locationUrl);
      }
    }
  } else if (error) return {
    error: response
  };
  else data = response;
  cacheKeyOp(keys, (entry) => entry[0] = 0);
  flightKeys && flightKeys.forEach((k) => query.set(k, custom[k]));
  await revalidate(keys, false);
  return data != null ? {
    data
  } : void 0;
}
export {
  actions as a,
  action as b,
  useSubmission as c,
  useSubmissions as d,
  cache as e,
  query as q,
  revalidate as r,
  useAction as u
};
