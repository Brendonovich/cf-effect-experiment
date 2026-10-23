import { g as getNextElement, t as template, s as spread, b as runHydrationEvents, d as delegateEvents, m as memo, i as insert } from "./web-Dl2sEcME.js";
import { t as createEffect, o as on$1, b as createComponent, S as Show, h as Suspense, m as mergeProps, e as createSignal, k as onMount } from "./solid-COykZtSy.js";
import { t as toast } from "./index-Dic9SOHc.js";
import { w as websiteRequest, r as reload, g as getAuthState, a as getUser } from "./api-BeJqlYcr.js";
import { L as LoginForm, S as SignUpForm } from "./Forms-t1wWmU5a.js";
import { b as action, u as useAction } from "./action-DEY4sCLp.js";
import { c as createAsync } from "./createAsync-DflW-LI1.js";
import { c as DropdownMenuTrigger, D as DropdownMenuContent, d as DropdownMenuSeparator, a as DropdownMenuItem, b as DropdownMenu } from "./dropdown-menu-LCNp2cQP.js";
import { o as useSearchParams } from "./routing-KR3q6KJw.js";
import { D as DialogTrigger, a as DialogContent, b as Dialog } from "./dialog-Cl8aIpB7.js";
import { B as Button } from "./button-dTk4F7f6.js";
function parse(str, options) {
  if (typeof str !== "string") {
    throw new TypeError("argument str must be a string");
  }
  const obj = {};
  const opt = {};
  const dec = opt.decode || decode;
  let index = 0;
  while (index < str.length) {
    const eqIdx = str.indexOf("=", index);
    if (eqIdx === -1) {
      break;
    }
    let endIdx = str.indexOf(";", index);
    if (endIdx === -1) {
      endIdx = str.length;
    } else if (endIdx < eqIdx) {
      index = str.lastIndexOf(";", eqIdx - 1) + 1;
      continue;
    }
    const key = str.slice(index, eqIdx).trim();
    if (opt?.filter && !opt?.filter(key)) {
      index = endIdx + 1;
      continue;
    }
    if (void 0 === obj[key]) {
      let val = str.slice(eqIdx + 1, endIdx).trim();
      if (val.codePointAt(0) === 34) {
        val = val.slice(1, -1);
      }
      obj[key] = tryDecode(val, dec);
    }
    index = endIdx + 1;
  }
  return obj;
}
function decode(str) {
  return str.includes("%") ? decodeURIComponent(str) : str;
}
function tryDecode(str, decode2) {
  try {
    return decode2(str);
  } catch {
    return str;
  }
}
var t = "undefined" != typeof window ? window : void 0, i = "undefined" != typeof globalThis ? globalThis : t, e = Array.prototype, r = e.forEach, s = e.indexOf, n = null == i ? void 0 : i.navigator, o = null == i ? void 0 : i.document, a = null == i ? void 0 : i.location, l = null == i ? void 0 : i.fetch, u = null != i && i.XMLHttpRequest && "withCredentials" in new i.XMLHttpRequest() ? i.XMLHttpRequest : void 0, h = null == i ? void 0 : i.AbortController, d = null == n ? void 0 : n.userAgent, v = null != t ? t : {}, c = {
  DEBUG: false,
  LIB_VERSION: "1.248.1"
}, f = "$copy_autocapture", p = ["$snapshot", "$pageview", "$pageleave", "$set", "survey dismissed", "survey sent", "survey shown", "$identify", "$groupidentify", "$create_alias", "$$client_ingestion_warning", "$web_experiment_applied", "$feature_enrollment_update", "$feature_flag_called"], g = (function(t2) {
  return t2.GZipJS = "gzip-js", t2.Base64 = "base64", t2;
})({}), _ = ["fatal", "error", "warning", "log", "info", "debug"];
function m(t2, i2) {
  return -1 !== t2.indexOf(i2);
}
var b = function(t2) {
  return t2.trim();
}, w = function(t2) {
  return t2.replace(/^\$/, "");
};
var y = Array.isArray, S = Object.prototype, $ = S.hasOwnProperty, k = S.toString, x = y || function(t2) {
  return "[object Array]" === k.call(t2);
}, E = (t2) => "function" == typeof t2, I = (t2) => t2 === Object(t2) && !x(t2), P = (t2) => {
  if (I(t2)) {
    for (var i2 in t2) if ($.call(t2, i2)) return false;
    return true;
  }
  return false;
}, R = (t2) => void 0 === t2, T = (t2) => "[object String]" == k.call(t2), M = (t2) => T(t2) && 0 === t2.trim().length, C = (t2) => null === t2, O = (t2) => R(t2) || C(t2), F = (t2) => "[object Number]" == k.call(t2), A = (t2) => "[object Boolean]" === k.call(t2), D = (t2) => t2 instanceof FormData, L = (t2) => m(p, t2), N = (i2) => {
  var e2 = {
    t: function(e3) {
      if (t && (c.DEBUG || v.POSTHOG_DEBUG) && !R(t.console) && t.console) {
        for (var r2 = ("__rrweb_original__" in t.console[e3]) ? t.console[e3].__rrweb_original__ : t.console[e3], s2 = arguments.length, n2 = new Array(s2 > 1 ? s2 - 1 : 0), o2 = 1; o2 < s2; o2++) n2[o2 - 1] = arguments[o2];
        r2(i2, ...n2);
      }
    },
    info: function() {
      for (var t2 = arguments.length, i3 = new Array(t2), r2 = 0; r2 < t2; r2++) i3[r2] = arguments[r2];
      e2.t("log", ...i3);
    },
    warn: function() {
      for (var t2 = arguments.length, i3 = new Array(t2), r2 = 0; r2 < t2; r2++) i3[r2] = arguments[r2];
      e2.t("warn", ...i3);
    },
    error: function() {
      for (var t2 = arguments.length, i3 = new Array(t2), r2 = 0; r2 < t2; r2++) i3[r2] = arguments[r2];
      e2.t("error", ...i3);
    },
    critical: function() {
      for (var t2 = arguments.length, e3 = new Array(t2), r2 = 0; r2 < t2; r2++) e3[r2] = arguments[r2];
      console.error(i2, ...e3);
    },
    uninitializedWarning: (t2) => {
      e2.error("You must initialize PostHog before calling " + t2);
    },
    createLogger: (t2) => N(i2 + " " + t2)
  };
  return e2;
}, j = N("[PostHog.js]"), z = j.createLogger, U = z("[ExternalScriptsLoader]"), q = (t2, i2, e2) => {
  if (t2.config.disable_external_dependency_loading) return U.warn(i2 + " was requested but loading of external scripts is disabled."), e2("Loading of external scripts is disabled");
  var r2 = null == o ? void 0 : o.querySelectorAll("script");
  if (r2) {
    for (var s2 = 0; s2 < r2.length; s2++) if (r2[s2].src === i2) return e2();
  }
  var n2 = () => {
    if (!o) return e2("document not found");
    var r3 = o.createElement("script");
    if (r3.type = "text/javascript", r3.crossOrigin = "anonymous", r3.src = i2, r3.onload = (t3) => e2(void 0, t3), r3.onerror = (t3) => e2(t3), t2.config.prepare_external_dependency_script && (r3 = t2.config.prepare_external_dependency_script(r3)), !r3) return e2("prepare_external_dependency_script returned null");
    var s3, n3 = o.querySelectorAll("body > script");
    n3.length > 0 ? null == (s3 = n3[0].parentNode) || s3.insertBefore(r3, n3[0]) : o.body.appendChild(r3);
  };
  null != o && o.body ? n2() : null == o || o.addEventListener("DOMContentLoaded", n2);
};
function B() {
  return B = Object.assign ? Object.assign.bind() : function(t2) {
    for (var i2 = 1; i2 < arguments.length; i2++) {
      var e2 = arguments[i2];
      for (var r2 in e2) ({}).hasOwnProperty.call(e2, r2) && (t2[r2] = e2[r2]);
    }
    return t2;
  }, B.apply(null, arguments);
}
function H(t2, i2) {
  if (null == t2) return {};
  var e2 = {};
  for (var r2 in t2) if ({}.hasOwnProperty.call(t2, r2)) {
    if (-1 !== i2.indexOf(r2)) continue;
    e2[r2] = t2[r2];
  }
  return e2;
}
v.__PosthogExtensions__ = v.__PosthogExtensions__ || {}, v.__PosthogExtensions__.loadExternalDependency = (t2, i2, e2) => {
  var r2 = "/static/" + i2 + ".js?v=" + t2.version;
  if ("remote-config" === i2 && (r2 = "/array/" + t2.config.token + "/config.js"), "toolbar" === i2) {
    var s2 = 3e5;
    r2 = r2 + "&t=" + Math.floor(Date.now() / s2) * s2;
  }
  var n2 = t2.requestRouter.endpointFor("assets", r2);
  q(t2, n2, e2);
}, v.__PosthogExtensions__.loadSiteApp = (t2, i2, e2) => {
  var r2 = t2.requestRouter.endpointFor("api", i2);
  q(t2, r2, e2);
};
var W = {};
function G(t2, i2, e2) {
  if (x(t2)) {
    if (r && t2.forEach === r) t2.forEach(i2, e2);
    else if ("length" in t2 && t2.length === +t2.length) {
      for (var s2 = 0, n2 = t2.length; s2 < n2; s2++) if (s2 in t2 && i2.call(e2, t2[s2], s2) === W) return;
    }
  }
}
function J(t2, i2, e2) {
  if (!O(t2)) {
    if (x(t2)) return G(t2, i2, e2);
    if (D(t2)) {
      for (var r2 of t2.entries()) if (i2.call(e2, r2[1], r2[0]) === W) return;
    } else for (var s2 in t2) if ($.call(t2, s2) && i2.call(e2, t2[s2], s2) === W) return;
  }
}
var V = function(t2) {
  for (var i2 = arguments.length, e2 = new Array(i2 > 1 ? i2 - 1 : 0), r2 = 1; r2 < i2; r2++) e2[r2 - 1] = arguments[r2];
  return G(e2, function(i3) {
    for (var e3 in i3) void 0 !== i3[e3] && (t2[e3] = i3[e3]);
  }), t2;
}, K = function(t2) {
  for (var i2 = arguments.length, e2 = new Array(i2 > 1 ? i2 - 1 : 0), r2 = 1; r2 < i2; r2++) e2[r2 - 1] = arguments[r2];
  return G(e2, function(i3) {
    G(i3, function(i4) {
      t2.push(i4);
    });
  }), t2;
};
function Y(t2) {
  for (var i2 = Object.keys(t2), e2 = i2.length, r2 = new Array(e2); e2--; ) r2[e2] = [i2[e2], t2[i2[e2]]];
  return r2;
}
var X = function(t2) {
  try {
    return t2();
  } catch (t3) {
    return;
  }
}, Q = function(t2) {
  return function() {
    try {
      for (var i2 = arguments.length, e2 = new Array(i2), r2 = 0; r2 < i2; r2++) e2[r2] = arguments[r2];
      return t2.apply(this, e2);
    } catch (t3) {
      j.critical("Implementation error. Please turn on debug mode and open a ticket on https://app.posthog.com/home#panel=support%3Asupport%3A."), j.critical(t3);
    }
  };
}, Z = function(t2) {
  var i2 = {};
  return J(t2, function(t3, e2) {
    (T(t3) && t3.length > 0 || F(t3)) && (i2[e2] = t3);
  }), i2;
};
function tt(t2, i2) {
  return e2 = t2, r2 = (t3) => T(t3) && !C(i2) ? t3.slice(0, i2) : t3, s2 = /* @__PURE__ */ new Set(), (function t3(i3, e3) {
    return i3 !== Object(i3) ? r2 ? r2(i3, e3) : i3 : s2.has(i3) ? void 0 : (s2.add(i3), x(i3) ? (n2 = [], G(i3, (i4) => {
      n2.push(t3(i4));
    })) : (n2 = {}, J(i3, (i4, e4) => {
      s2.has(i4) || (n2[e4] = t3(i4, e4));
    })), n2);
    var n2;
  })(e2);
  var e2, r2, s2;
}
var it = ["herokuapp.com", "vercel.app", "netlify.app"];
function et(t2) {
  var i2 = null == t2 ? void 0 : t2.hostname;
  if (!T(i2)) return false;
  var e2 = i2.split(".").slice(-2).join(".");
  for (var r2 of it) if (e2 === r2) return false;
  return true;
}
function rt(t2, i2) {
  for (var e2 = 0; e2 < t2.length; e2++) if (i2(t2[e2])) return t2[e2];
}
function st(t2, i2, e2, r2) {
  var {
    capture: s2 = false,
    passive: n2 = true
  } = null != r2 ? r2 : {};
  null == t2 || t2.addEventListener(i2, e2, {
    capture: s2,
    passive: n2
  });
}
var nt = "$people_distinct_id", ot = "__alias", at = "__timers", lt = "$autocapture_disabled_server_side", ut = "$heatmaps_enabled_server_side", ht = "$exception_capture_enabled_server_side", dt = "$error_tracking_suppression_rules", vt = "$web_vitals_enabled_server_side", ct = "$dead_clicks_enabled_server_side", ft = "$web_vitals_allowed_metrics", pt = "$session_recording_enabled_server_side", gt = "$console_log_recording_enabled_server_side", _t = "$session_recording_network_payload_capture", mt = "$session_recording_masking", bt = "$session_recording_canvas_recording", wt = "$replay_sample_rate", yt = "$replay_minimum_duration", St = "$replay_script_config", $t = "$sesid", kt = "$session_is_sampled", xt = "$session_recording_url_trigger_activated_session", Et = "$session_recording_event_trigger_activated_session", It = "$enabled_feature_flags", Pt = "$early_access_features", Rt = "$feature_flag_details", Tt = "$stored_person_properties", Mt = "$stored_group_properties", Ct = "$surveys", Ot = "$surveys_activated", Ft = "$flag_call_reported", At = "$user_state", Dt = "$client_session_props", Lt = "$capture_rate_limit", Nt = "$initial_campaign_params", jt = "$initial_referrer_info", zt = "$initial_person_info", Ut = "$epp", qt = "__POSTHOG_TOOLBAR__", Bt = "$posthog_cookieless", Ht = [nt, ot, "__cmpns", at, pt, ut, $t, It, dt, At, Pt, Rt, Mt, Tt, Ct, Ft, Dt, Lt, Nt, jt, Ut, zt];
function Wt(t2) {
  return t2 instanceof Element && (t2.id === qt || !(null == t2.closest || !t2.closest(".toolbar-global-fade-container")));
}
function Gt(t2) {
  return !!t2 && 1 === t2.nodeType;
}
function Jt(t2, i2) {
  return !!t2 && !!t2.tagName && t2.tagName.toLowerCase() === i2.toLowerCase();
}
function Vt(t2) {
  return !!t2 && 3 === t2.nodeType;
}
function Kt(t2) {
  return !!t2 && 11 === t2.nodeType;
}
function Yt(t2) {
  return t2 ? b(t2).split(/\s+/) : [];
}
function Xt(i2) {
  var e2 = null == t ? void 0 : t.location.href;
  return !!(e2 && i2 && i2.some((t2) => e2.match(t2)));
}
function Qt(t2) {
  var i2 = "";
  switch (typeof t2.className) {
    case "string":
      i2 = t2.className;
      break;
    case "object":
      i2 = (t2.className && "baseVal" in t2.className ? t2.className.baseVal : null) || t2.getAttribute("class") || "";
      break;
    default:
      i2 = "";
  }
  return Yt(i2);
}
function Zt(t2) {
  return O(t2) ? null : b(t2).split(/(\s+)/).filter((t3) => ci(t3)).join("").replace(/[\r\n]/g, " ").replace(/[ ]+/g, " ").substring(0, 255);
}
function ti(t2) {
  var i2 = "";
  return ni(t2) && !oi(t2) && t2.childNodes && t2.childNodes.length && J(t2.childNodes, function(t3) {
    var e2;
    Vt(t3) && t3.textContent && (i2 += null !== (e2 = Zt(t3.textContent)) && void 0 !== e2 ? e2 : "");
  }), b(i2);
}
function ii(t2) {
  return R(t2.target) ? t2.srcElement || null : null != (i2 = t2.target) && i2.shadowRoot ? t2.composedPath()[0] || null : t2.target || null;
  var i2;
}
var ei = ["a", "button", "form", "input", "select", "textarea", "label"];
function ri(t2) {
  var i2 = t2.parentNode;
  return !(!i2 || !Gt(i2)) && i2;
}
function si(i2, e2, r2, s2, n2) {
  var o2, a2, l2;
  if (void 0 === r2 && (r2 = void 0), !t || !i2 || Jt(i2, "html") || !Gt(i2)) return false;
  if (null != (o2 = r2) && o2.url_allowlist && !Xt(r2.url_allowlist)) return false;
  if (null != (a2 = r2) && a2.url_ignorelist && Xt(r2.url_ignorelist)) return false;
  if (null != (l2 = r2) && l2.dom_event_allowlist) {
    var u2 = r2.dom_event_allowlist;
    if (u2 && !u2.some((t2) => e2.type === t2)) return false;
  }
  for (var h2 = false, d2 = [i2], v2 = true, c2 = i2; c2.parentNode && !Jt(c2, "body"); ) if (Kt(c2.parentNode)) d2.push(c2.parentNode.host), c2 = c2.parentNode.host;
  else {
    if (!(v2 = ri(c2))) break;
    if (s2 || ei.indexOf(v2.tagName.toLowerCase()) > -1) h2 = true;
    else {
      var f2 = t.getComputedStyle(v2);
      f2 && "pointer" === f2.getPropertyValue("cursor") && (h2 = true);
    }
    d2.push(v2), c2 = v2;
  }
  if (!(function(t2, i3) {
    var e3 = null == i3 ? void 0 : i3.element_allowlist;
    if (R(e3)) return true;
    var r3, s3 = function(t3) {
      if (e3.some((i4) => t3.tagName.toLowerCase() === i4)) return {
        v: true
      };
    };
    for (var n3 of t2) if (r3 = s3(n3)) return r3.v;
    return false;
  })(d2, r2)) return false;
  if (!(function(t2, i3) {
    var e3 = null == i3 ? void 0 : i3.css_selector_allowlist;
    if (R(e3)) return true;
    var r3, s3 = function(t3) {
      if (e3.some((i4) => t3.matches(i4))) return {
        v: true
      };
    };
    for (var n3 of t2) if (r3 = s3(n3)) return r3.v;
    return false;
  })(d2, r2)) return false;
  var p2 = t.getComputedStyle(i2);
  if (p2 && "pointer" === p2.getPropertyValue("cursor") && "click" === e2.type) return true;
  var g2 = i2.tagName.toLowerCase();
  switch (g2) {
    case "html":
      return false;
    case "form":
      return (n2 || ["submit"]).indexOf(e2.type) >= 0;
    case "input":
    case "select":
    case "textarea":
      return (n2 || ["change", "click"]).indexOf(e2.type) >= 0;
    default:
      return h2 ? (n2 || ["click"]).indexOf(e2.type) >= 0 : (n2 || ["click"]).indexOf(e2.type) >= 0 && (ei.indexOf(g2) > -1 || "true" === i2.getAttribute("contenteditable"));
  }
}
function ni(t2) {
  for (var i2 = t2; i2.parentNode && !Jt(i2, "body"); i2 = i2.parentNode) {
    var e2 = Qt(i2);
    if (m(e2, "ph-sensitive") || m(e2, "ph-no-capture")) return false;
  }
  if (m(Qt(t2), "ph-include")) return true;
  var r2 = t2.type || "";
  if (T(r2)) switch (r2.toLowerCase()) {
    case "hidden":
    case "password":
      return false;
  }
  var s2 = t2.name || t2.id || "";
  if (T(s2)) {
    if (/^cc|cardnum|ccnum|creditcard|csc|cvc|cvv|exp|pass|pwd|routing|seccode|securitycode|securitynum|socialsec|socsec|ssn/i.test(s2.replace(/[^a-zA-Z0-9]/g, ""))) return false;
  }
  return true;
}
function oi(t2) {
  return !!(Jt(t2, "input") && !["button", "checkbox", "submit", "reset"].includes(t2.type) || Jt(t2, "select") || Jt(t2, "textarea") || "true" === t2.getAttribute("contenteditable"));
}
var ai = "(4[0-9]{12}(?:[0-9]{3})?)|(5[1-5][0-9]{14})|(6(?:011|5[0-9]{2})[0-9]{12})|(3[47][0-9]{13})|(3(?:0[0-5]|[68][0-9])[0-9]{11})|((?:2131|1800|35[0-9]{3})[0-9]{11})", li = new RegExp("^(?:" + ai + ")$"), ui = new RegExp(ai), hi = "\\d{3}-?\\d{2}-?\\d{4}", di = new RegExp("^(" + hi + ")$"), vi = new RegExp("(" + hi + ")");
function ci(t2, i2) {
  if (void 0 === i2 && (i2 = true), O(t2)) return false;
  if (T(t2)) {
    if (t2 = b(t2), (i2 ? li : ui).test((t2 || "").replace(/[- ]/g, ""))) return false;
    if ((i2 ? di : vi).test(t2)) return false;
  }
  return true;
}
function fi(t2) {
  var i2 = ti(t2);
  return ci(i2 = (i2 + " " + pi(t2)).trim()) ? i2 : "";
}
function pi(t2) {
  var i2 = "";
  return t2 && t2.childNodes && t2.childNodes.length && J(t2.childNodes, function(t3) {
    var e2;
    if (t3 && "span" === (null == (e2 = t3.tagName) ? void 0 : e2.toLowerCase())) try {
      var r2 = ti(t3);
      i2 = (i2 + " " + r2).trim(), t3.childNodes && t3.childNodes.length && (i2 = (i2 + " " + pi(t3)).trim());
    } catch (t4) {
      j.error("[AutoCapture]", t4);
    }
  }), i2;
}
function gi(t2) {
  return (function(t3) {
    var i2 = t3.map((t4) => {
      var i3, e2, r2 = "";
      if (t4.tag_name && (r2 += t4.tag_name), t4.attr_class) for (var s2 of (t4.attr_class.sort(), t4.attr_class)) r2 += "." + s2.replace(/"/g, "");
      var n2 = B({}, t4.text ? {
        text: t4.text
      } : {}, {
        "nth-child": null !== (i3 = t4.nth_child) && void 0 !== i3 ? i3 : 0,
        "nth-of-type": null !== (e2 = t4.nth_of_type) && void 0 !== e2 ? e2 : 0
      }, t4.href ? {
        href: t4.href
      } : {}, t4.attr_id ? {
        attr_id: t4.attr_id
      } : {}, t4.attributes), o2 = {};
      return Y(n2).sort((t5, i4) => {
        var [e3] = t5, [r3] = i4;
        return e3.localeCompare(r3);
      }).forEach((t5) => {
        var [i4, e3] = t5;
        return o2[_i(i4.toString())] = _i(e3.toString());
      }), r2 += ":", r2 += Y(o2).map((t5) => {
        var [i4, e3] = t5;
        return i4 + '="' + e3 + '"';
      }).join("");
    });
    return i2.join(";");
  })((function(t3) {
    return t3.map((t4) => {
      var i2, e2, r2 = {
        text: null == (i2 = t4.$el_text) ? void 0 : i2.slice(0, 400),
        tag_name: t4.tag_name,
        href: null == (e2 = t4.attr__href) ? void 0 : e2.slice(0, 2048),
        attr_class: mi(t4),
        attr_id: t4.attr__id,
        nth_child: t4.nth_child,
        nth_of_type: t4.nth_of_type,
        attributes: {}
      };
      return Y(t4).filter((t5) => {
        var [i3] = t5;
        return 0 === i3.indexOf("attr__");
      }).forEach((t5) => {
        var [i3, e3] = t5;
        return r2.attributes[i3] = e3;
      }), r2;
    });
  })(t2));
}
function _i(t2) {
  return t2.replace(/"|\\"/g, '\\"');
}
function mi(t2) {
  var i2 = t2.attr__class;
  return i2 ? x(i2) ? i2 : Yt(i2) : void 0;
}
class bi {
  constructor() {
    this.clicks = [];
  }
  isRageClick(t2, i2, e2) {
    var r2 = this.clicks[this.clicks.length - 1];
    if (r2 && Math.abs(t2 - r2.x) + Math.abs(i2 - r2.y) < 30 && e2 - r2.timestamp < 1e3) {
      if (this.clicks.push({
        x: t2,
        y: i2,
        timestamp: e2
      }), 3 === this.clicks.length) return true;
    } else this.clicks = [{
      x: t2,
      y: i2,
      timestamp: e2
    }];
    return false;
  }
}
var wi = ["localhost", "127.0.0.1"], yi = (t2) => {
  var i2 = null == o ? void 0 : o.createElement("a");
  return R(i2) ? null : (i2.href = t2, i2);
}, Si = function(t2, i2) {
  var e2, r2;
  void 0 === i2 && (i2 = "&");
  var s2 = [];
  return J(t2, function(t3, i3) {
    R(t3) || R(i3) || "undefined" === i3 || (e2 = encodeURIComponent(((t4) => t4 instanceof File)(t3) ? t3.name : t3.toString()), r2 = encodeURIComponent(i3), s2[s2.length] = r2 + "=" + e2);
  }), s2.join(i2);
}, $i = function(t2, i2) {
  for (var e2, r2 = ((t2.split("#")[0] || "").split(/\?(.*)/)[1] || "").replace(/^\?+/g, "").split("&"), s2 = 0; s2 < r2.length; s2++) {
    var n2 = r2[s2].split("=");
    if (n2[0] === i2) {
      e2 = n2;
      break;
    }
  }
  if (!x(e2) || e2.length < 2) return "";
  var o2 = e2[1];
  try {
    o2 = decodeURIComponent(o2);
  } catch (t3) {
    j.error("Skipping decoding for malformed query param: " + o2);
  }
  return o2.replace(/\+/g, " ");
}, ki = function(t2, i2, e2) {
  if (!t2 || !i2 || !i2.length) return t2;
  for (var r2 = t2.split("#"), s2 = r2[0] || "", n2 = r2[1], o2 = s2.split("?"), a2 = o2[1], l2 = o2[0], u2 = (a2 || "").split("&"), h2 = [], d2 = 0; d2 < u2.length; d2++) {
    var v2 = u2[d2].split("=");
    x(v2) && (i2.includes(v2[0]) ? h2.push(v2[0] + "=" + e2) : h2.push(u2[d2]));
  }
  var c2 = l2;
  return null != a2 && (c2 += "?" + h2.join("&")), null != n2 && (c2 += "#" + n2), c2;
}, xi = function(t2, i2) {
  var e2 = t2.match(new RegExp(i2 + "=([^&]*)"));
  return e2 ? e2[1] : null;
}, Ei = z("[AutoCapture]");
function Ii(t2, i2) {
  return i2.length > t2 ? i2.slice(0, t2) + "..." : i2;
}
function Pi(t2) {
  if (t2.previousElementSibling) return t2.previousElementSibling;
  var i2 = t2;
  do {
    i2 = i2.previousSibling;
  } while (i2 && !Gt(i2));
  return i2;
}
function Ri(t2, i2, e2, r2) {
  var s2 = t2.tagName.toLowerCase(), n2 = {
    tag_name: s2
  };
  ei.indexOf(s2) > -1 && !e2 && ("a" === s2.toLowerCase() || "button" === s2.toLowerCase() ? n2.$el_text = Ii(1024, fi(t2)) : n2.$el_text = Ii(1024, ti(t2)));
  var o2 = Qt(t2);
  o2.length > 0 && (n2.classes = o2.filter(function(t3) {
    return "" !== t3;
  })), J(t2.attributes, function(e3) {
    var s3;
    if ((!oi(t2) || -1 !== ["name", "id", "class", "aria-label"].indexOf(e3.name)) && (null == r2 || !r2.includes(e3.name)) && !i2 && ci(e3.value) && (s3 = e3.name, !T(s3) || "_ngcontent" !== s3.substring(0, 10) && "_nghost" !== s3.substring(0, 7))) {
      var o3 = e3.value;
      "class" === e3.name && (o3 = Yt(o3).join(" ")), n2["attr__" + e3.name] = Ii(1024, o3);
    }
  });
  for (var a2 = 1, l2 = 1, u2 = t2; u2 = Pi(u2); ) a2++, u2.tagName === t2.tagName && l2++;
  return n2.nth_child = a2, n2.nth_of_type = l2, n2;
}
function Ti(i2, e2) {
  for (var r2, s2, {
    e: n2,
    maskAllElementAttributes: o2,
    maskAllText: a2,
    elementAttributeIgnoreList: l2,
    elementsChainAsString: u2
  } = e2, h2 = [i2], d2 = i2; d2.parentNode && !Jt(d2, "body"); ) Kt(d2.parentNode) ? (h2.push(d2.parentNode.host), d2 = d2.parentNode.host) : (h2.push(d2.parentNode), d2 = d2.parentNode);
  var v2, c2 = [], f2 = {}, p2 = false, g2 = false;
  if (J(h2, (t2) => {
    var i3 = ni(t2);
    "a" === t2.tagName.toLowerCase() && (p2 = t2.getAttribute("href"), p2 = i3 && p2 && ci(p2) && p2), m(Qt(t2), "ph-no-capture") && (g2 = true), c2.push(Ri(t2, o2, a2, l2));
    var e3 = (function(t3) {
      if (!ni(t3)) return {};
      var i4 = {};
      return J(t3.attributes, function(t4) {
        if (t4.name && 0 === t4.name.indexOf("data-ph-capture-attribute")) {
          var e4 = t4.name.replace("data-ph-capture-attribute-", ""), r3 = t4.value;
          e4 && r3 && ci(r3) && (i4[e4] = r3);
        }
      }), i4;
    })(t2);
    V(f2, e3);
  }), g2) return {
    props: {},
    explicitNoCapture: g2
  };
  if (a2 || ("a" === i2.tagName.toLowerCase() || "button" === i2.tagName.toLowerCase() ? c2[0].$el_text = fi(i2) : c2[0].$el_text = ti(i2)), p2) {
    var _2, b2;
    c2[0].attr__href = p2;
    var w2 = null == (_2 = yi(p2)) ? void 0 : _2.host, y2 = null == t || null == (b2 = t.location) ? void 0 : b2.host;
    w2 && y2 && w2 !== y2 && (v2 = p2);
  }
  return {
    props: V({
      $event_type: n2.type,
      $ce_version: 1
    }, u2 ? {} : {
      $elements: c2
    }, {
      $elements_chain: gi(c2)
    }, null != (r2 = c2[0]) && r2.$el_text ? {
      $el_text: null == (s2 = c2[0]) ? void 0 : s2.$el_text
    } : {}, v2 && "click" === n2.type ? {
      $external_click_url: v2
    } : {}, f2)
  };
}
class Mi {
  constructor(t2) {
    this.i = false, this.o = null, this.rageclicks = new bi(), this.h = false, this.instance = t2, this.m = null;
  }
  get S() {
    var t2, i2, e2 = I(this.instance.config.autocapture) ? this.instance.config.autocapture : {};
    return e2.url_allowlist = null == (t2 = e2.url_allowlist) ? void 0 : t2.map((t3) => new RegExp(t3)), e2.url_ignorelist = null == (i2 = e2.url_ignorelist) ? void 0 : i2.map((t3) => new RegExp(t3)), e2;
  }
  $() {
    if (this.isBrowserSupported()) {
      if (t && o) {
        var i2 = (i3) => {
          i3 = i3 || (null == t ? void 0 : t.event);
          try {
            this.k(i3);
          } catch (t2) {
            Ei.error("Failed to capture event", t2);
          }
        };
        if (st(o, "submit", i2, {
          capture: true
        }), st(o, "change", i2, {
          capture: true
        }), st(o, "click", i2, {
          capture: true
        }), this.S.capture_copied_text) {
          var e2 = (i3) => {
            i3 = i3 || (null == t ? void 0 : t.event), this.k(i3, f);
          };
          st(o, "copy", e2, {
            capture: true
          }), st(o, "cut", e2, {
            capture: true
          });
        }
      }
    } else Ei.info("Disabling Automatic Event Collection because this browser is not supported");
  }
  startIfEnabled() {
    this.isEnabled && !this.i && (this.$(), this.i = true);
  }
  onRemoteConfig(t2) {
    t2.elementsChainAsString && (this.h = t2.elementsChainAsString), this.instance.persistence && this.instance.persistence.register({
      [lt]: !!t2.autocapture_opt_out
    }), this.o = !!t2.autocapture_opt_out, this.startIfEnabled();
  }
  setElementSelectors(t2) {
    this.m = t2;
  }
  getElementSelectors(t2) {
    var i2, e2 = [];
    return null == (i2 = this.m) || i2.forEach((i3) => {
      var r2 = null == o ? void 0 : o.querySelectorAll(i3);
      null == r2 || r2.forEach((r3) => {
        t2 === r3 && e2.push(i3);
      });
    }), e2;
  }
  get isEnabled() {
    var t2, i2, e2 = null == (t2 = this.instance.persistence) ? void 0 : t2.props[lt], r2 = this.o;
    if (C(r2) && !A(e2) && !this.instance.config.advanced_disable_decide) return false;
    var s2 = null !== (i2 = this.o) && void 0 !== i2 ? i2 : !!e2;
    return !!this.instance.config.autocapture && !s2;
  }
  k(i2, e2) {
    if (void 0 === e2 && (e2 = "$autocapture"), this.isEnabled) {
      var r2, s2 = ii(i2);
      if (Vt(s2) && (s2 = s2.parentNode || null), "$autocapture" === e2 && "click" === i2.type && i2 instanceof MouseEvent) this.instance.config.rageclick && null != (r2 = this.rageclicks) && r2.isRageClick(i2.clientX, i2.clientY, (/* @__PURE__ */ new Date()).getTime()) && this.k(i2, "$rageclick");
      var n2 = e2 === f;
      if (s2 && si(s2, i2, this.S, n2, n2 ? ["copy", "cut"] : void 0)) {
        var {
          props: o2,
          explicitNoCapture: a2
        } = Ti(s2, {
          e: i2,
          maskAllElementAttributes: this.instance.config.mask_all_element_attributes,
          maskAllText: this.instance.config.mask_all_text,
          elementAttributeIgnoreList: this.S.element_attribute_ignorelist,
          elementsChainAsString: this.h
        });
        if (a2) return false;
        var l2 = this.getElementSelectors(s2);
        if (l2 && l2.length > 0 && (o2.$element_selectors = l2), e2 === f) {
          var u2, h2 = Zt(null == t || null == (u2 = t.getSelection()) ? void 0 : u2.toString()), d2 = i2.type || "clipboard";
          if (!h2) return false;
          o2.$selected_content = h2, o2.$copy_type = d2;
        }
        return this.instance.capture(e2, o2), true;
      }
    }
  }
  isBrowserSupported() {
    return E(null == o ? void 0 : o.querySelectorAll);
  }
}
Math.trunc || (Math.trunc = function(t2) {
  return t2 < 0 ? Math.ceil(t2) : Math.floor(t2);
}), Number.isInteger || (Number.isInteger = function(t2) {
  return F(t2) && isFinite(t2) && Math.floor(t2) === t2;
});
var Ci = "0123456789abcdef";
class Oi {
  constructor(t2) {
    if (this.bytes = t2, 16 !== t2.length) throw new TypeError("not 128-bit length");
  }
  static fromFieldsV7(t2, i2, e2, r2) {
    if (!Number.isInteger(t2) || !Number.isInteger(i2) || !Number.isInteger(e2) || !Number.isInteger(r2) || t2 < 0 || i2 < 0 || e2 < 0 || r2 < 0 || t2 > 281474976710655 || i2 > 4095 || e2 > 1073741823 || r2 > 4294967295) throw new RangeError("invalid field value");
    var s2 = new Uint8Array(16);
    return s2[0] = t2 / Math.pow(2, 40), s2[1] = t2 / Math.pow(2, 32), s2[2] = t2 / Math.pow(2, 24), s2[3] = t2 / Math.pow(2, 16), s2[4] = t2 / Math.pow(2, 8), s2[5] = t2, s2[6] = 112 | i2 >>> 8, s2[7] = i2, s2[8] = 128 | e2 >>> 24, s2[9] = e2 >>> 16, s2[10] = e2 >>> 8, s2[11] = e2, s2[12] = r2 >>> 24, s2[13] = r2 >>> 16, s2[14] = r2 >>> 8, s2[15] = r2, new Oi(s2);
  }
  toString() {
    for (var t2 = "", i2 = 0; i2 < this.bytes.length; i2++) t2 = t2 + Ci.charAt(this.bytes[i2] >>> 4) + Ci.charAt(15 & this.bytes[i2]), 3 !== i2 && 5 !== i2 && 7 !== i2 && 9 !== i2 || (t2 += "-");
    if (36 !== t2.length) throw new Error("Invalid UUIDv7 was generated");
    return t2;
  }
  clone() {
    return new Oi(this.bytes.slice(0));
  }
  equals(t2) {
    return 0 === this.compareTo(t2);
  }
  compareTo(t2) {
    for (var i2 = 0; i2 < 16; i2++) {
      var e2 = this.bytes[i2] - t2.bytes[i2];
      if (0 !== e2) return Math.sign(e2);
    }
    return 0;
  }
}
class Fi {
  constructor() {
    this.I = 0, this.P = 0, this.R = new Li();
  }
  generate() {
    var t2 = this.generateOrAbort();
    if (R(t2)) {
      this.I = 0;
      var i2 = this.generateOrAbort();
      if (R(i2)) throw new Error("Could not generate UUID after timestamp reset");
      return i2;
    }
    return t2;
  }
  generateOrAbort() {
    var t2 = Date.now();
    if (t2 > this.I) this.I = t2, this.T();
    else {
      if (!(t2 + 1e4 > this.I)) return;
      this.P++, this.P > 4398046511103 && (this.I++, this.T());
    }
    return Oi.fromFieldsV7(this.I, Math.trunc(this.P / Math.pow(2, 30)), this.P & Math.pow(2, 30) - 1, this.R.nextUint32());
  }
  T() {
    this.P = 1024 * this.R.nextUint32() + (1023 & this.R.nextUint32());
  }
}
var Ai, Di = (t2) => {
  if ("undefined" != typeof UUIDV7_DENY_WEAK_RNG && UUIDV7_DENY_WEAK_RNG) throw new Error("no cryptographically strong RNG available");
  for (var i2 = 0; i2 < t2.length; i2++) t2[i2] = 65536 * Math.trunc(65536 * Math.random()) + Math.trunc(65536 * Math.random());
  return t2;
};
t && !R(t.crypto) && crypto.getRandomValues && (Di = (t2) => crypto.getRandomValues(t2));
class Li {
  constructor() {
    this.M = new Uint32Array(8), this.C = 1 / 0;
  }
  nextUint32() {
    return this.C >= this.M.length && (Di(this.M), this.C = 0), this.M[this.C++];
  }
}
var Ni = () => ji().toString(), ji = () => (Ai || (Ai = new Fi())).generate(), zi = "";
var Ui = /[a-z0-9][a-z0-9-]+\.[a-z]{2,}$/i;
function qi(t2, i2) {
  if (i2) {
    var e2 = (function(t3, i3) {
      if (void 0 === i3 && (i3 = o), zi) return zi;
      if (!i3) return "";
      if (["localhost", "127.0.0.1"].includes(t3)) return "";
      for (var e3 = t3.split("."), r3 = Math.min(e3.length, 8), s2 = "dmn_chk_" + Ni(); !zi && r3--; ) {
        var n2 = e3.slice(r3).join("."), a2 = s2 + "=1;domain=." + n2 + ";path=/";
        i3.cookie = a2 + ";max-age=3", i3.cookie.includes(s2) && (i3.cookie = a2 + ";max-age=0", zi = n2);
      }
      return zi;
    })(t2);
    if (!e2) {
      var r2 = ((t3) => {
        var i3 = t3.match(Ui);
        return i3 ? i3[0] : "";
      })(t2);
      r2 !== e2 && j.info("Warning: cookie subdomain discovery mismatch", r2, e2), e2 = r2;
    }
    return e2 ? "; domain=." + e2 : "";
  }
  return "";
}
var Bi = {
  O: () => !!o,
  F: function(t2) {
    j.error("cookieStore error: " + t2);
  },
  A: function(t2) {
    if (o) {
      try {
        for (var i2 = t2 + "=", e2 = o.cookie.split(";").filter((t3) => t3.length), r2 = 0; r2 < e2.length; r2++) {
          for (var s2 = e2[r2]; " " == s2.charAt(0); ) s2 = s2.substring(1, s2.length);
          if (0 === s2.indexOf(i2)) return decodeURIComponent(s2.substring(i2.length, s2.length));
        }
      } catch (t3) {
      }
      return null;
    }
  },
  D: function(t2) {
    var i2;
    try {
      i2 = JSON.parse(Bi.A(t2)) || {};
    } catch (t3) {
    }
    return i2;
  },
  L: function(t2, i2, e2, r2, s2) {
    if (o) try {
      var n2 = "", a2 = "", l2 = qi(o.location.hostname, r2);
      if (e2) {
        var u2 = /* @__PURE__ */ new Date();
        u2.setTime(u2.getTime() + 24 * e2 * 60 * 60 * 1e3), n2 = "; expires=" + u2.toUTCString();
      }
      s2 && (a2 = "; secure");
      var h2 = t2 + "=" + encodeURIComponent(JSON.stringify(i2)) + n2 + "; SameSite=Lax; path=/" + l2 + a2;
      return h2.length > 3686.4 && j.warn("cookieStore warning: large cookie, len=" + h2.length), o.cookie = h2, h2;
    } catch (t3) {
      return;
    }
  },
  N: function(t2, i2) {
    try {
      Bi.L(t2, "", -1, i2);
    } catch (t3) {
      return;
    }
  }
}, Hi = null, Wi = {
  O: function() {
    if (!C(Hi)) return Hi;
    var i2 = true;
    if (R(t)) i2 = false;
    else try {
      var e2 = "__mplssupport__";
      Wi.L(e2, "xyz"), '"xyz"' !== Wi.A(e2) && (i2 = false), Wi.N(e2);
    } catch (t2) {
      i2 = false;
    }
    return i2 || j.error("localStorage unsupported; falling back to cookie store"), Hi = i2, i2;
  },
  F: function(t2) {
    j.error("localStorage error: " + t2);
  },
  A: function(i2) {
    try {
      return null == t ? void 0 : t.localStorage.getItem(i2);
    } catch (t2) {
      Wi.F(t2);
    }
    return null;
  },
  D: function(t2) {
    try {
      return JSON.parse(Wi.A(t2)) || {};
    } catch (t3) {
    }
    return null;
  },
  L: function(i2, e2) {
    try {
      null == t || t.localStorage.setItem(i2, JSON.stringify(e2));
    } catch (t2) {
      Wi.F(t2);
    }
  },
  N: function(i2) {
    try {
      null == t || t.localStorage.removeItem(i2);
    } catch (t2) {
      Wi.F(t2);
    }
  }
}, Gi = ["distinct_id", $t, kt, Ut, zt], Ji = B({}, Wi, {
  D: function(t2) {
    try {
      var i2 = {};
      try {
        i2 = Bi.D(t2) || {};
      } catch (t3) {
      }
      var e2 = V(i2, JSON.parse(Wi.A(t2) || "{}"));
      return Wi.L(t2, e2), e2;
    } catch (t3) {
    }
    return null;
  },
  L: function(t2, i2, e2, r2, s2, n2) {
    try {
      Wi.L(t2, i2, void 0, void 0, n2);
      var o2 = {};
      Gi.forEach((t3) => {
        i2[t3] && (o2[t3] = i2[t3]);
      }), Object.keys(o2).length && Bi.L(t2, o2, e2, r2, s2, n2);
    } catch (t3) {
      Wi.F(t3);
    }
  },
  N: function(i2, e2) {
    try {
      null == t || t.localStorage.removeItem(i2), Bi.N(i2, e2);
    } catch (t2) {
      Wi.F(t2);
    }
  }
}), Vi = {}, Ki = {
  O: function() {
    return true;
  },
  F: function(t2) {
    j.error("memoryStorage error: " + t2);
  },
  A: function(t2) {
    return Vi[t2] || null;
  },
  D: function(t2) {
    return Vi[t2] || null;
  },
  L: function(t2, i2) {
    Vi[t2] = i2;
  },
  N: function(t2) {
    delete Vi[t2];
  }
}, Yi = null, Xi = {
  O: function() {
    if (!C(Yi)) return Yi;
    if (Yi = true, R(t)) Yi = false;
    else try {
      var i2 = "__support__";
      Xi.L(i2, "xyz"), '"xyz"' !== Xi.A(i2) && (Yi = false), Xi.N(i2);
    } catch (t2) {
      Yi = false;
    }
    return Yi;
  },
  F: function(t2) {
    j.error("sessionStorage error: ", t2);
  },
  A: function(i2) {
    try {
      return null == t ? void 0 : t.sessionStorage.getItem(i2);
    } catch (t2) {
      Xi.F(t2);
    }
    return null;
  },
  D: function(t2) {
    try {
      return JSON.parse(Xi.A(t2)) || null;
    } catch (t3) {
    }
    return null;
  },
  L: function(i2, e2) {
    try {
      null == t || t.sessionStorage.setItem(i2, JSON.stringify(e2));
    } catch (t2) {
      Xi.F(t2);
    }
  },
  N: function(i2) {
    try {
      null == t || t.sessionStorage.removeItem(i2);
    } catch (t2) {
      Xi.F(t2);
    }
  }
}, Qi = (function(t2) {
  return t2[t2.PENDING = -1] = "PENDING", t2[t2.DENIED = 0] = "DENIED", t2[t2.GRANTED = 1] = "GRANTED", t2;
})({});
class Zi {
  constructor(t2) {
    this._instance = t2;
  }
  get S() {
    return this._instance.config;
  }
  get consent() {
    return this.j() ? Qi.DENIED : this.U;
  }
  isOptedOut() {
    return this.consent === Qi.DENIED || this.consent === Qi.PENDING && this.S.opt_out_capturing_by_default;
  }
  isOptedIn() {
    return !this.isOptedOut();
  }
  optInOut(t2) {
    this.q.L(this.B, t2 ? 1 : 0, this.S.cookie_expiration, this.S.cross_subdomain_cookie, this.S.secure_cookie);
  }
  reset() {
    this.q.N(this.B, this.S.cross_subdomain_cookie);
  }
  get B() {
    var {
      token: t2,
      opt_out_capturing_cookie_prefix: i2
    } = this._instance.config;
    return (i2 || "__ph_opt_in_out_") + t2;
  }
  get U() {
    var t2 = this.q.A(this.B);
    return "1" === t2 ? Qi.GRANTED : "0" === t2 ? Qi.DENIED : Qi.PENDING;
  }
  get q() {
    if (!this.H) {
      var t2 = this.S.opt_out_capturing_persistence_type;
      this.H = "localStorage" === t2 ? Wi : Bi;
      var i2 = "localStorage" === t2 ? Bi : Wi;
      i2.A(this.B) && (this.H.A(this.B) || this.optInOut("1" === i2.A(this.B)), i2.N(this.B, this.S.cross_subdomain_cookie));
    }
    return this.H;
  }
  j() {
    return !!this.S.respect_dnt && !!rt([null == n ? void 0 : n.doNotTrack, null == n ? void 0 : n.msDoNotTrack, v.doNotTrack], (t2) => m([true, 1, "1", "yes"], t2));
  }
}
var te = z("[Dead Clicks]"), ie = () => true, ee = (t2) => {
  var i2, e2 = !(null == (i2 = t2.instance.persistence) || !i2.get_property(ct)), r2 = t2.instance.config.capture_dead_clicks;
  return A(r2) ? r2 : e2;
};
class re {
  get lazyLoadedDeadClicksAutocapture() {
    return this.W;
  }
  constructor(t2, i2, e2) {
    this.instance = t2, this.isEnabled = i2, this.onCapture = e2, this.startIfEnabled();
  }
  onRemoteConfig(t2) {
    this.instance.persistence && this.instance.persistence.register({
      [ct]: null == t2 ? void 0 : t2.captureDeadClicks
    }), this.startIfEnabled();
  }
  startIfEnabled() {
    this.isEnabled(this) && this.G(() => {
      this.J();
    });
  }
  G(t2) {
    var i2, e2;
    null != (i2 = v.__PosthogExtensions__) && i2.initDeadClicksAutocapture && t2(), null == (e2 = v.__PosthogExtensions__) || null == e2.loadExternalDependency || e2.loadExternalDependency(this.instance, "dead-clicks-autocapture", (i3) => {
      i3 ? te.error("failed to load script", i3) : t2();
    });
  }
  J() {
    var t2;
    if (o) {
      if (!this.W && null != (t2 = v.__PosthogExtensions__) && t2.initDeadClicksAutocapture) {
        var i2 = I(this.instance.config.capture_dead_clicks) ? this.instance.config.capture_dead_clicks : {};
        i2.__onCapture = this.onCapture, this.W = v.__PosthogExtensions__.initDeadClicksAutocapture(this.instance, i2), this.W.start(o), te.info("starting...");
      }
    } else te.error("`document` not found. Cannot start.");
  }
  stop() {
    this.W && (this.W.stop(), this.W = void 0, te.info("stopping..."));
  }
}
var se = z("[ExceptionAutocapture]");
class ne {
  constructor(i2) {
    var e2;
    this.V = () => {
      var i3;
      if (t && this.isEnabled && null != (i3 = v.__PosthogExtensions__) && i3.errorWrappingFunctions) {
        var e3 = v.__PosthogExtensions__.errorWrappingFunctions.wrapOnError, r2 = v.__PosthogExtensions__.errorWrappingFunctions.wrapUnhandledRejection, s2 = v.__PosthogExtensions__.errorWrappingFunctions.wrapConsoleError;
        try {
          !this.K && this.S.capture_unhandled_errors && (this.K = e3(this.captureException.bind(this))), !this.Y && this.S.capture_unhandled_rejections && (this.Y = r2(this.captureException.bind(this))), !this.X && this.S.capture_console_errors && (this.X = s2(this.captureException.bind(this)));
        } catch (t2) {
          se.error("failed to start", t2), this.Z();
        }
      }
    }, this._instance = i2, this.tt = !(null == (e2 = this._instance.persistence) || !e2.props[ht]), this.S = this.it(), this.startIfEnabled();
  }
  it() {
    var t2 = this._instance.config.capture_exceptions, i2 = {
      capture_unhandled_errors: false,
      capture_unhandled_rejections: false,
      capture_console_errors: false
    };
    return I(t2) ? i2 = B({}, i2, t2) : (R(t2) ? this.tt : t2) && (i2 = B({}, i2, {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true
    })), i2;
  }
  get isEnabled() {
    return this.S.capture_console_errors || this.S.capture_unhandled_errors || this.S.capture_unhandled_rejections;
  }
  startIfEnabled() {
    this.isEnabled && (se.info("enabled"), this.G(this.V));
  }
  G(t2) {
    var i2, e2;
    null != (i2 = v.__PosthogExtensions__) && i2.errorWrappingFunctions && t2(), null == (e2 = v.__PosthogExtensions__) || null == e2.loadExternalDependency || e2.loadExternalDependency(this._instance, "exception-autocapture", (i3) => {
      if (i3) return se.error("failed to load script", i3);
      t2();
    });
  }
  Z() {
    var t2, i2, e2;
    null == (t2 = this.K) || t2.call(this), this.K = void 0, null == (i2 = this.Y) || i2.call(this), this.Y = void 0, null == (e2 = this.X) || e2.call(this), this.X = void 0;
  }
  onRemoteConfig(t2) {
    var i2 = t2.autocaptureExceptions;
    this.tt = !!i2 || false, this.S = this.it(), this._instance.persistence && this._instance.persistence.register({
      [ht]: this.tt
    }), this.startIfEnabled();
  }
  captureException(t2) {
    var i2 = this._instance.requestRouter.endpointFor("ui");
    t2.$exception_personURL = i2 + "/project/" + this._instance.config.token + "/person/" + this._instance.get_distinct_id(), this._instance.exceptions.sendExceptionEvent(t2);
  }
}
function oe(t2) {
  return !R(Event) && ae(t2, Event);
}
function ae(t2, i2) {
  try {
    return t2 instanceof i2;
  } catch (t3) {
    return false;
  }
}
function le(t2) {
  switch (Object.prototype.toString.call(t2)) {
    case "[object Error]":
    case "[object Exception]":
    case "[object DOMException]":
    case "[object DOMError]":
      return true;
    default:
      return ae(t2, Error);
  }
}
function ue(t2, i2) {
  return Object.prototype.toString.call(t2) === "[object " + i2 + "]";
}
function he(t2) {
  return ue(t2, "DOMError");
}
var de = /\(error: (.*)\)/, ve = 50, ce = "?";
function fe(t2, i2, e2, r2) {
  var s2 = {
    platform: "web:javascript",
    filename: t2,
    function: "<anonymous>" === i2 ? ce : i2,
    in_app: true
  };
  return R(e2) || (s2.lineno = e2), R(r2) || (s2.colno = r2), s2;
}
var pe = /^\s*at (\S+?)(?::(\d+))(?::(\d+))\s*$/i, ge = /^\s*at (?:(.+?\)(?: \[.+\])?|.*?) ?\((?:address at )?)?(?:async )?((?:<anonymous>|[-a-z]+:|.*bundle|\/)?.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i, _e = /\((\S*)(?::(\d+))(?::(\d+))\)/, me = /^\s*(.*?)(?:\((.*?)\))?(?:^|@)?((?:[-a-z]+)?:\/.*?|\[native code\]|[^@]*(?:bundle|\d+\.js)|\/[\w\-. /=]+)(?::(\d+))?(?::(\d+))?\s*$/i, be = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i, we = (function() {
  for (var t2 = arguments.length, i2 = new Array(t2), e2 = 0; e2 < t2; e2++) i2[e2] = arguments[e2];
  var r2 = i2.sort((t3, i3) => t3[0] - i3[0]).map((t3) => t3[1]);
  return function(t3, i3) {
    void 0 === i3 && (i3 = 0);
    for (var e3 = [], s2 = t3.split("\n"), n2 = i3; n2 < s2.length; n2++) {
      var o2 = s2[n2];
      if (!(o2.length > 1024)) {
        var a2 = de.test(o2) ? o2.replace(de, "$1") : o2;
        if (!a2.match(/\S*Error: /)) {
          for (var l2 of r2) {
            var u2 = l2(a2);
            if (u2) {
              e3.push(u2);
              break;
            }
          }
          if (e3.length >= ve) break;
        }
      }
    }
    return (function(t4) {
      if (!t4.length) return [];
      var i4 = Array.from(t4);
      return i4.reverse(), i4.slice(0, ve).map((t5) => B({}, t5, {
        filename: t5.filename || ye(i4).filename,
        function: t5.function || ce
      }));
    })(e3);
  };
})(...[[30, (t2) => {
  var i2 = pe.exec(t2);
  if (i2) {
    var [, e2, r2, s2] = i2;
    return fe(e2, ce, +r2, +s2);
  }
  var n2 = ge.exec(t2);
  if (n2) {
    if (n2[2] && 0 === n2[2].indexOf("eval")) {
      var o2 = _e.exec(n2[2]);
      o2 && (n2[2] = o2[1], n2[3] = o2[2], n2[4] = o2[3]);
    }
    var [a2, l2] = xe(n2[1] || ce, n2[2]);
    return fe(l2, a2, n2[3] ? +n2[3] : void 0, n2[4] ? +n2[4] : void 0);
  }
}], [50, (t2) => {
  var i2 = me.exec(t2);
  if (i2) {
    if (i2[3] && i2[3].indexOf(" > eval") > -1) {
      var e2 = be.exec(i2[3]);
      e2 && (i2[1] = i2[1] || "eval", i2[3] = e2[1], i2[4] = e2[2], i2[5] = "");
    }
    var r2 = i2[3], s2 = i2[1] || ce;
    return [s2, r2] = xe(s2, r2), fe(r2, s2, i2[4] ? +i2[4] : void 0, i2[5] ? +i2[5] : void 0);
  }
}]]);
function ye(t2) {
  return t2[t2.length - 1] || {};
}
var Se, $e, ke, xe = (t2, i2) => {
  var e2 = -1 !== t2.indexOf("safari-extension"), r2 = -1 !== t2.indexOf("safari-web-extension");
  return e2 || r2 ? [-1 !== t2.indexOf("@") ? t2.split("@")[0] : ce, e2 ? "safari-extension:" + i2 : "safari-web-extension:" + i2] : [t2, i2];
};
var Ee = /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i;
function Ie(t2, i2) {
  void 0 === i2 && (i2 = 0);
  var e2 = t2.stacktrace || t2.stack || "", r2 = (function(t3) {
    if (t3 && Pe.test(t3.message)) return 1;
    return 0;
  })(t2);
  try {
    var s2 = we, n2 = (function(t3, i3) {
      var e3 = (function(t4) {
        var i4 = globalThis._posthogChunkIds;
        if (!i4) return {};
        var e4 = Object.keys(i4);
        return ke && e4.length === $e || ($e = e4.length, ke = e4.reduce((e5, r3) => {
          Se || (Se = {});
          var s3 = Se[r3];
          if (s3) e5[s3[0]] = s3[1];
          else for (var n3 = t4(r3), o2 = n3.length - 1; o2 >= 0; o2--) {
            var a2 = n3[o2], l2 = null == a2 ? void 0 : a2.filename, u2 = i4[r3];
            if (l2 && u2) {
              e5[l2] = u2, Se[r3] = [l2, u2];
              break;
            }
          }
          return e5;
        }, {})), ke;
      })(i3);
      return t3.forEach((t4) => {
        t4.filename && (t4.chunk_id = e3[t4.filename]);
      }), t3;
    })(s2(e2, r2), s2);
    return n2.slice(0, n2.length - i2);
  } catch (t3) {
  }
  return [];
}
var Pe = /Minified React error #\d+;/i;
function Re(t2, i2) {
  var e2, r2, s2 = Ie(t2), n2 = null === (e2 = null == i2 ? void 0 : i2.handled) || void 0 === e2 || e2, o2 = null !== (r2 = null == i2 ? void 0 : i2.synthetic) && void 0 !== r2 && r2;
  return {
    type: null != i2 && i2.overrideExceptionType ? i2.overrideExceptionType : t2.name,
    value: (function(t3) {
      var i3 = t3.message;
      if (i3.error && "string" == typeof i3.error.message) return String(i3.error.message);
      return String(i3);
    })(t2),
    stacktrace: {
      frames: s2,
      type: "raw"
    },
    mechanism: {
      handled: n2,
      synthetic: o2
    }
  };
}
function Te(t2, i2) {
  var e2 = Re(t2, i2);
  return t2.cause && le(t2.cause) && t2.cause !== t2 ? [e2, ...Te(t2.cause, {
    handled: null == i2 ? void 0 : i2.handled,
    synthetic: null == i2 ? void 0 : i2.synthetic
  })] : [e2];
}
function Me(t2, i2) {
  return {
    $exception_list: Te(t2, i2),
    $exception_level: "error"
  };
}
function Ce(t2, i2) {
  var e2, r2, s2, n2 = null === (e2 = null == i2 ? void 0 : i2.handled) || void 0 === e2 || e2, o2 = null === (r2 = null == i2 ? void 0 : i2.synthetic) || void 0 === r2 || r2, a2 = {
    type: null != i2 && i2.overrideExceptionType ? i2.overrideExceptionType : null !== (s2 = null == i2 ? void 0 : i2.defaultExceptionType) && void 0 !== s2 ? s2 : "Error",
    value: t2 || (null == i2 ? void 0 : i2.defaultExceptionMessage),
    mechanism: {
      handled: n2,
      synthetic: o2
    }
  };
  if (null != i2 && i2.syntheticException) {
    var l2 = Ie(i2.syntheticException, 1);
    l2.length && (a2.stacktrace = {
      frames: l2,
      type: "raw"
    });
  }
  return {
    $exception_list: [a2],
    $exception_level: "error"
  };
}
function Oe(t2) {
  return T(t2) && !M(t2) && _.indexOf(t2) >= 0;
}
function Fe(t2, i2) {
  var e2, r2, s2 = null === (e2 = null == i2 ? void 0 : i2.handled) || void 0 === e2 || e2, n2 = null === (r2 = null == i2 ? void 0 : i2.synthetic) || void 0 === r2 || r2, o2 = null != i2 && i2.overrideExceptionType ? i2.overrideExceptionType : oe(t2) ? t2.constructor.name : "Error", a2 = "Non-Error 'exception' captured with keys: " + (function(t3, i3) {
    void 0 === i3 && (i3 = 40);
    var e3 = Object.keys(t3);
    if (e3.sort(), !e3.length) return "[object has no keys]";
    for (var r3 = e3.length; r3 > 0; r3--) {
      var s3 = e3.slice(0, r3).join(", ");
      if (!(s3.length > i3)) return r3 === e3.length || s3.length <= i3 ? s3 : s3.slice(0, i3) + "...";
    }
    return "";
  })(t2), l2 = {
    type: o2,
    value: a2,
    mechanism: {
      handled: s2,
      synthetic: n2
    }
  };
  if (null != i2 && i2.syntheticException) {
    var u2 = Ie(null == i2 ? void 0 : i2.syntheticException, 1);
    u2.length && (l2.stacktrace = {
      frames: u2,
      type: "raw"
    });
  }
  return {
    $exception_list: [l2],
    $exception_level: Oe(t2.level) ? t2.level : "error"
  };
}
function Ae(t2, i2) {
  var {
    error: e2,
    event: r2
  } = t2, s2 = {
    $exception_list: []
  }, n2 = e2 || r2;
  if (he(n2) || (function(t3) {
    return ue(t3, "DOMException");
  })(n2)) {
    var o2 = n2;
    if ((function(t3) {
      return "stack" in t3;
    })(n2)) s2 = Me(n2, i2);
    else {
      var a2 = o2.name || (he(o2) ? "DOMError" : "DOMException"), l2 = o2.message ? a2 + ": " + o2.message : a2;
      s2 = Ce(l2, B({}, i2, {
        overrideExceptionType: he(o2) ? "DOMError" : "DOMException",
        defaultExceptionMessage: l2
      }));
    }
    return "code" in o2 && (s2.$exception_DOMException_code = "" + o2.code), s2;
  }
  if ((function(t3) {
    return ue(t3, "ErrorEvent");
  })(n2) && n2.error) return Me(n2.error, i2);
  if (le(n2)) return Me(n2, i2);
  if ((function(t3) {
    return ue(t3, "Object");
  })(n2) || oe(n2)) return Fe(n2, i2);
  if (R(e2) && T(r2)) {
    var u2 = "Error", h2 = r2, d2 = r2.match(Ee);
    return d2 && (u2 = d2[1], h2 = d2[2]), Ce(h2, B({}, i2, {
      overrideExceptionType: u2,
      defaultExceptionMessage: h2
    }));
  }
  return Ce(n2, i2);
}
function De(t2, i2, e2) {
  try {
    if (!(i2 in t2)) return () => {
    };
    var r2 = t2[i2], s2 = e2(r2);
    return E(s2) && (s2.prototype = s2.prototype || {}, Object.defineProperties(s2, {
      __posthog_wrapped__: {
        enumerable: false,
        value: true
      }
    })), t2[i2] = s2, () => {
      t2[i2] = r2;
    };
  } catch (t3) {
    return () => {
    };
  }
}
class Le {
  constructor(i2) {
    var e2;
    this._instance = i2, this.et = (null == t || null == (e2 = t.location) ? void 0 : e2.pathname) || "";
  }
  get isEnabled() {
    return "history_change" === this._instance.config.capture_pageview;
  }
  startIfEnabled() {
    this.isEnabled && (j.info("History API monitoring enabled, starting..."), this.monitorHistoryChanges());
  }
  stop() {
    this.rt && this.rt(), this.rt = void 0, j.info("History API monitoring stopped");
  }
  monitorHistoryChanges() {
    var i2, e2;
    if (t && t.history) {
      var r2 = this;
      null != (i2 = t.history.pushState) && i2.__posthog_wrapped__ || De(t.history, "pushState", (t2) => function(i3, e3, s2) {
        t2.call(this, i3, e3, s2), r2.st("pushState");
      }), null != (e2 = t.history.replaceState) && e2.__posthog_wrapped__ || De(t.history, "replaceState", (t2) => function(i3, e3, s2) {
        t2.call(this, i3, e3, s2), r2.st("replaceState");
      }), this.nt();
    }
  }
  st(i2) {
    try {
      var e2, r2 = null == t || null == (e2 = t.location) ? void 0 : e2.pathname;
      if (!r2) return;
      r2 !== this.et && this.isEnabled && this._instance.capture("$pageview", {
        navigation_type: i2
      }), this.et = r2;
    } catch (t2) {
      j.error("Error capturing " + i2 + " pageview", t2);
    }
  }
  nt() {
    if (!this.rt) {
      var i2 = () => {
        this.st("popstate");
      };
      st(t, "popstate", i2), this.rt = () => {
        t && t.removeEventListener("popstate", i2);
      };
    }
  }
}
function Ne(t2) {
  var i2, e2;
  return (null == (i2 = JSON.stringify(t2, (e2 = [], function(t3, i3) {
    if (I(i3)) {
      for (; e2.length > 0 && e2[e2.length - 1] !== this; ) e2.pop();
      return e2.includes(i3) ? "[Circular]" : (e2.push(i3), i3);
    }
    return i3;
  }))) ? void 0 : i2.length) || 0;
}
function je(t2, i2) {
  if (void 0 === i2 && (i2 = 66060288e-1), t2.size >= i2 && t2.data.length > 1) {
    var e2 = Math.floor(t2.data.length / 2), r2 = t2.data.slice(0, e2), s2 = t2.data.slice(e2);
    return [je({
      size: Ne(r2),
      data: r2,
      sessionId: t2.sessionId,
      windowId: t2.windowId
    }), je({
      size: Ne(s2),
      data: s2,
      sessionId: t2.sessionId,
      windowId: t2.windowId
    })].flatMap((t3) => t3);
  }
  return [t2];
}
var ze = ((t2) => (t2[t2.DomContentLoaded = 0] = "DomContentLoaded", t2[t2.Load = 1] = "Load", t2[t2.FullSnapshot = 2] = "FullSnapshot", t2[t2.IncrementalSnapshot = 3] = "IncrementalSnapshot", t2[t2.Meta = 4] = "Meta", t2[t2.Custom = 5] = "Custom", t2[t2.Plugin = 6] = "Plugin", t2))(ze || {}), Ue = ((t2) => (t2[t2.Mutation = 0] = "Mutation", t2[t2.MouseMove = 1] = "MouseMove", t2[t2.MouseInteraction = 2] = "MouseInteraction", t2[t2.Scroll = 3] = "Scroll", t2[t2.ViewportResize = 4] = "ViewportResize", t2[t2.Input = 5] = "Input", t2[t2.TouchMove = 6] = "TouchMove", t2[t2.MediaInteraction = 7] = "MediaInteraction", t2[t2.StyleSheetRule = 8] = "StyleSheetRule", t2[t2.CanvasMutation = 9] = "CanvasMutation", t2[t2.Font = 10] = "Font", t2[t2.Log = 11] = "Log", t2[t2.Drag = 12] = "Drag", t2[t2.StyleDeclaration = 13] = "StyleDeclaration", t2[t2.Selection = 14] = "Selection", t2[t2.AdoptedStyleSheet = 15] = "AdoptedStyleSheet", t2[t2.CustomElement = 16] = "CustomElement", t2))(Ue || {}), qe = "[SessionRecording]", Be = "redacted", He = {
  initiatorTypes: ["audio", "beacon", "body", "css", "early-hint", "embed", "fetch", "frame", "iframe", "icon", "image", "img", "input", "link", "navigation", "object", "ping", "script", "track", "video", "xmlhttprequest"],
  maskRequestFn: (t2) => t2,
  recordHeaders: false,
  recordBody: false,
  recordInitialRequests: false,
  recordPerformance: false,
  performanceEntryTypeToObserve: ["first-input", "navigation", "paint", "resource"],
  payloadSizeLimitBytes: 1e6,
  payloadHostDenyList: [".lr-ingest.io", ".ingest.sentry.io", ".clarity.ms", "analytics.google.com", "bam.nr-data.net"]
}, We = ["authorization", "x-forwarded-for", "authorization", "cookie", "set-cookie", "x-api-key", "x-real-ip", "remote-addr", "forwarded", "proxy-authorization", "x-csrf-token", "x-csrftoken", "x-xsrf-token"], Ge = ["password", "secret", "passwd", "api_key", "apikey", "auth", "credentials", "mysql_pwd", "privatekey", "private_key", "token"], Je = ["/s/", "/e/", "/i/"];
function Ve(t2, i2, e2, r2) {
  if (O(t2)) return t2;
  var s2 = (null == i2 ? void 0 : i2["content-length"]) || (function(t3) {
    return new Blob([t3]).size;
  })(t2);
  return T(s2) && (s2 = parseInt(s2)), s2 > e2 ? qe + " " + r2 + " body too large to record (" + s2 + " bytes)" : t2;
}
function Ke(t2, i2) {
  if (O(t2)) return t2;
  var e2 = t2;
  return ci(e2, false) || (e2 = qe + " " + i2 + " body " + Be), J(Ge, (t3) => {
    var r2, s2;
    null != (r2 = e2) && r2.length && -1 !== (null == (s2 = e2) ? void 0 : s2.indexOf(t3)) && (e2 = qe + " " + i2 + " body " + Be + " as might contain: " + t3);
  }), e2;
}
var Ye = (t2, i2) => {
  var e2, r2, s2, n2 = {
    payloadSizeLimitBytes: He.payloadSizeLimitBytes,
    performanceEntryTypeToObserve: [...He.performanceEntryTypeToObserve],
    payloadHostDenyList: [...i2.payloadHostDenyList || [], ...He.payloadHostDenyList]
  }, o2 = false !== t2.session_recording.recordHeaders && i2.recordHeaders, a2 = false !== t2.session_recording.recordBody && i2.recordBody, l2 = false !== t2.capture_performance && i2.recordPerformance, u2 = (e2 = n2, s2 = Math.min(1e6, null !== (r2 = e2.payloadSizeLimitBytes) && void 0 !== r2 ? r2 : 1e6), (t3) => (null != t3 && t3.requestBody && (t3.requestBody = Ve(t3.requestBody, t3.requestHeaders, s2, "Request")), null != t3 && t3.responseBody && (t3.responseBody = Ve(t3.responseBody, t3.responseHeaders, s2, "Response")), t3)), h2 = (i3) => {
    return u2(((t3, i4) => {
      var e4, r4 = yi(t3.name), s3 = 0 === i4.indexOf("http") ? null == (e4 = yi(i4)) ? void 0 : e4.pathname : i4;
      "/" === s3 && (s3 = "");
      var n3 = null == r4 ? void 0 : r4.pathname.replace(s3 || "", "");
      if (!(r4 && n3 && Je.some((t4) => 0 === n3.indexOf(t4)))) return t3;
    })((r3 = (e3 = i3).requestHeaders, O(r3) || J(Object.keys(null != r3 ? r3 : {}), (t3) => {
      We.includes(t3.toLowerCase()) && (r3[t3] = Be);
    }), e3), t2.api_host));
    var e3, r3;
  }, d2 = E(t2.session_recording.maskNetworkRequestFn);
  return d2 && E(t2.session_recording.maskCapturedNetworkRequestFn) && j.warn("Both `maskNetworkRequestFn` and `maskCapturedNetworkRequestFn` are defined. `maskNetworkRequestFn` will be ignored."), d2 && (t2.session_recording.maskCapturedNetworkRequestFn = (i3) => {
    var e3 = t2.session_recording.maskNetworkRequestFn({
      url: i3.name
    });
    return B({}, i3, {
      name: null == e3 ? void 0 : e3.url
    });
  }), n2.maskRequestFn = E(t2.session_recording.maskCapturedNetworkRequestFn) ? (i3) => {
    var e3, r3 = h2(i3);
    return r3 && null !== (e3 = null == t2.session_recording.maskCapturedNetworkRequestFn ? void 0 : t2.session_recording.maskCapturedNetworkRequestFn(r3)) && void 0 !== e3 ? e3 : void 0;
  } : (t3) => (function(t4) {
    if (!R(t4)) return t4.requestBody = Ke(t4.requestBody, "Request"), t4.responseBody = Ke(t4.responseBody, "Response"), t4;
  })(h2(t3)), B({}, He, n2, {
    recordHeaders: o2,
    recordBody: a2,
    recordPerformance: l2,
    recordInitialRequests: l2
  });
};
function Xe(t2, i2, e2, r2, s2) {
  return i2 > e2 && (j.warn("min cannot be greater than max."), i2 = e2), F(t2) ? t2 > e2 ? (r2 && j.warn(r2 + " cannot be  greater than max: " + e2 + ". Using max value instead."), e2) : t2 < i2 ? (r2 && j.warn(r2 + " cannot be less than min: " + i2 + ". Using min value instead."), i2) : t2 : (r2 && j.warn(r2 + " must be a number. using max or fallback. max: " + e2 + ", fallback: " + s2), Xe(s2 || e2, i2, e2, r2));
}
class Qe {
  constructor(t2, i2) {
    var e2, r2;
    void 0 === i2 && (i2 = {}), this.ot = 100, this.lt = 10, this.ut = {}, this.ht = {}, this.dt = () => {
      Object.keys(this.ut).forEach((t3) => {
        this.ut[t3] = this.ut[t3] + this.lt, this.ut[t3] >= this.ot && delete this.ut[t3];
      });
    }, this.vt = (t3) => {
      var i3 = this._rrweb.mirror.getNode(t3);
      if ("svg" !== (null == i3 ? void 0 : i3.nodeName) && i3 instanceof Element) {
        var e3 = i3.closest("svg");
        if (e3) return [this._rrweb.mirror.getId(e3), e3];
      }
      return [t3, i3];
    }, this.ct = (t3) => {
      var i3, e3, r3, s2, n2, o2, a2, l2;
      return (null !== (i3 = null == (e3 = t3.removes) ? void 0 : e3.length) && void 0 !== i3 ? i3 : 0) + (null !== (r3 = null == (s2 = t3.attributes) ? void 0 : s2.length) && void 0 !== r3 ? r3 : 0) + (null !== (n2 = null == (o2 = t3.texts) ? void 0 : o2.length) && void 0 !== n2 ? n2 : 0) + (null !== (a2 = null == (l2 = t3.adds) ? void 0 : l2.length) && void 0 !== a2 ? a2 : 0);
    }, this.throttleMutations = (t3) => {
      if (3 !== t3.type || 0 !== t3.data.source) return t3;
      var i3 = t3.data, e3 = this.ct(i3);
      i3.attributes && (i3.attributes = i3.attributes.filter((t4) => {
        var i4, e4, r4, [s2, n2] = this.vt(t4.id);
        if (0 === this.ut[s2]) return false;
        (this.ut[s2] = null !== (i4 = this.ut[s2]) && void 0 !== i4 ? i4 : this.ot, this.ut[s2] = Math.max(this.ut[s2] - 1, 0), 0 === this.ut[s2]) && (this.ht[s2] || (this.ht[s2] = true, null == (e4 = (r4 = this.ft).onBlockedNode) || e4.call(r4, s2, n2)));
        return t4;
      }));
      var r3 = this.ct(i3);
      return 0 !== r3 || e3 === r3 ? t3 : void 0;
    }, this._rrweb = t2, this.ft = i2, this.lt = Xe(null !== (e2 = this.ft.refillRate) && void 0 !== e2 ? e2 : this.lt, 0, 100, "mutation throttling refill rate"), this.ot = Xe(null !== (r2 = this.ft.bucketSize) && void 0 !== r2 ? r2 : this.ot, 0, 100, "mutation throttling bucket size"), setInterval(() => {
      this.dt();
    }, 1e3);
  }
}
var Ze = Uint8Array, tr = Uint16Array, ir = Uint32Array, er = new Ze([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]), rr = new Ze([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]), sr = new Ze([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]), nr = function(t2, i2) {
  for (var e2 = new tr(31), r2 = 0; r2 < 31; ++r2) e2[r2] = i2 += 1 << t2[r2 - 1];
  var s2 = new ir(e2[30]);
  for (r2 = 1; r2 < 30; ++r2) for (var n2 = e2[r2]; n2 < e2[r2 + 1]; ++n2) s2[n2] = n2 - e2[r2] << 5 | r2;
  return [e2, s2];
}, or = nr(er, 2), ar = or[0], lr = or[1];
ar[28] = 258, lr[258] = 28;
for (var ur = nr(rr, 0)[1], hr = new tr(32768), dr = 0; dr < 32768; ++dr) {
  var vr = (43690 & dr) >>> 1 | (21845 & dr) << 1;
  vr = (61680 & (vr = (52428 & vr) >>> 2 | (13107 & vr) << 2)) >>> 4 | (3855 & vr) << 4, hr[dr] = ((65280 & vr) >>> 8 | (255 & vr) << 8) >>> 1;
}
var cr = function(t2, i2, e2) {
  for (var r2 = t2.length, s2 = 0, n2 = new tr(i2); s2 < r2; ++s2) ++n2[t2[s2] - 1];
  var o2, a2 = new tr(i2);
  for (s2 = 0; s2 < i2; ++s2) a2[s2] = a2[s2 - 1] + n2[s2 - 1] << 1;
  for (o2 = new tr(r2), s2 = 0; s2 < r2; ++s2) o2[s2] = hr[a2[t2[s2] - 1]++] >>> 15 - t2[s2];
  return o2;
}, fr = new Ze(288);
for (dr = 0; dr < 144; ++dr) fr[dr] = 8;
for (dr = 144; dr < 256; ++dr) fr[dr] = 9;
for (dr = 256; dr < 280; ++dr) fr[dr] = 7;
for (dr = 280; dr < 288; ++dr) fr[dr] = 8;
var pr = new Ze(32);
for (dr = 0; dr < 32; ++dr) pr[dr] = 5;
var gr = cr(fr, 9), _r = cr(pr, 5), mr = function(t2) {
  return (t2 / 8 >> 0) + (7 & t2 && 1);
}, br = function(t2, i2, e2) {
  (null == e2 || e2 > t2.length) && (e2 = t2.length);
  var r2 = new (t2 instanceof tr ? tr : t2 instanceof ir ? ir : Ze)(e2 - i2);
  return r2.set(t2.subarray(i2, e2)), r2;
}, wr = function(t2, i2, e2) {
  e2 <<= 7 & i2;
  var r2 = i2 / 8 >> 0;
  t2[r2] |= e2, t2[r2 + 1] |= e2 >>> 8;
}, yr = function(t2, i2, e2) {
  e2 <<= 7 & i2;
  var r2 = i2 / 8 >> 0;
  t2[r2] |= e2, t2[r2 + 1] |= e2 >>> 8, t2[r2 + 2] |= e2 >>> 16;
}, Sr = function(t2, i2) {
  for (var e2 = [], r2 = 0; r2 < t2.length; ++r2) t2[r2] && e2.push({
    s: r2,
    f: t2[r2]
  });
  var s2 = e2.length, n2 = e2.slice();
  if (!s2) return [new Ze(0), 0];
  if (1 == s2) {
    var o2 = new Ze(e2[0].s + 1);
    return o2[e2[0].s] = 1, [o2, 1];
  }
  e2.sort(function(t3, i3) {
    return t3.f - i3.f;
  }), e2.push({
    s: -1,
    f: 25001
  });
  var a2 = e2[0], l2 = e2[1], u2 = 0, h2 = 1, d2 = 2;
  for (e2[0] = {
    s: -1,
    f: a2.f + l2.f,
    l: a2,
    r: l2
  }; h2 != s2 - 1; ) a2 = e2[e2[u2].f < e2[d2].f ? u2++ : d2++], l2 = e2[u2 != h2 && e2[u2].f < e2[d2].f ? u2++ : d2++], e2[h2++] = {
    s: -1,
    f: a2.f + l2.f,
    l: a2,
    r: l2
  };
  var v2 = n2[0].s;
  for (r2 = 1; r2 < s2; ++r2) n2[r2].s > v2 && (v2 = n2[r2].s);
  var c2 = new tr(v2 + 1), f2 = $r(e2[h2 - 1], c2, 0);
  if (f2 > i2) {
    r2 = 0;
    var p2 = 0, g2 = f2 - i2, _2 = 1 << g2;
    for (n2.sort(function(t3, i3) {
      return c2[i3.s] - c2[t3.s] || t3.f - i3.f;
    }); r2 < s2; ++r2) {
      var m2 = n2[r2].s;
      if (!(c2[m2] > i2)) break;
      p2 += _2 - (1 << f2 - c2[m2]), c2[m2] = i2;
    }
    for (p2 >>>= g2; p2 > 0; ) {
      var b2 = n2[r2].s;
      c2[b2] < i2 ? p2 -= 1 << i2 - c2[b2]++ - 1 : ++r2;
    }
    for (; r2 >= 0 && p2; --r2) {
      var w2 = n2[r2].s;
      c2[w2] == i2 && (--c2[w2], ++p2);
    }
    f2 = i2;
  }
  return [new Ze(c2), f2];
}, $r = function(t2, i2, e2) {
  return -1 == t2.s ? Math.max($r(t2.l, i2, e2 + 1), $r(t2.r, i2, e2 + 1)) : i2[t2.s] = e2;
}, kr = function(t2) {
  for (var i2 = t2.length; i2 && !t2[--i2]; ) ;
  for (var e2 = new tr(++i2), r2 = 0, s2 = t2[0], n2 = 1, o2 = function(t3) {
    e2[r2++] = t3;
  }, a2 = 1; a2 <= i2; ++a2) if (t2[a2] == s2 && a2 != i2) ++n2;
  else {
    if (!s2 && n2 > 2) {
      for (; n2 > 138; n2 -= 138) o2(32754);
      n2 > 2 && (o2(n2 > 10 ? n2 - 11 << 5 | 28690 : n2 - 3 << 5 | 12305), n2 = 0);
    } else if (n2 > 3) {
      for (o2(s2), --n2; n2 > 6; n2 -= 6) o2(8304);
      n2 > 2 && (o2(n2 - 3 << 5 | 8208), n2 = 0);
    }
    for (; n2--; ) o2(s2);
    n2 = 1, s2 = t2[a2];
  }
  return [e2.subarray(0, r2), i2];
}, xr = function(t2, i2) {
  for (var e2 = 0, r2 = 0; r2 < i2.length; ++r2) e2 += t2[r2] * i2[r2];
  return e2;
}, Er = function(t2, i2, e2) {
  var r2 = e2.length, s2 = mr(i2 + 2);
  t2[s2] = 255 & r2, t2[s2 + 1] = r2 >>> 8, t2[s2 + 2] = 255 ^ t2[s2], t2[s2 + 3] = 255 ^ t2[s2 + 1];
  for (var n2 = 0; n2 < r2; ++n2) t2[s2 + n2 + 4] = e2[n2];
  return 8 * (s2 + 4 + r2);
}, Ir = function(t2, i2, e2, r2, s2, n2, o2, a2, l2, u2, h2) {
  wr(i2, h2++, e2), ++s2[256];
  for (var d2 = Sr(s2, 15), v2 = d2[0], c2 = d2[1], f2 = Sr(n2, 15), p2 = f2[0], g2 = f2[1], _2 = kr(v2), m2 = _2[0], b2 = _2[1], w2 = kr(p2), y2 = w2[0], S2 = w2[1], $2 = new tr(19), k2 = 0; k2 < m2.length; ++k2) $2[31 & m2[k2]]++;
  for (k2 = 0; k2 < y2.length; ++k2) $2[31 & y2[k2]]++;
  for (var x2 = Sr($2, 7), E2 = x2[0], I2 = x2[1], P2 = 19; P2 > 4 && !E2[sr[P2 - 1]]; --P2) ;
  var R2, T2, M2, C2, O2 = u2 + 5 << 3, F2 = xr(s2, fr) + xr(n2, pr) + o2, A2 = xr(s2, v2) + xr(n2, p2) + o2 + 14 + 3 * P2 + xr($2, E2) + (2 * $2[16] + 3 * $2[17] + 7 * $2[18]);
  if (O2 <= F2 && O2 <= A2) return Er(i2, h2, t2.subarray(l2, l2 + u2));
  if (wr(i2, h2, 1 + (A2 < F2)), h2 += 2, A2 < F2) {
    R2 = cr(v2, c2), T2 = v2, M2 = cr(p2, g2), C2 = p2;
    var D2 = cr(E2, I2);
    wr(i2, h2, b2 - 257), wr(i2, h2 + 5, S2 - 1), wr(i2, h2 + 10, P2 - 4), h2 += 14;
    for (k2 = 0; k2 < P2; ++k2) wr(i2, h2 + 3 * k2, E2[sr[k2]]);
    h2 += 3 * P2;
    for (var L2 = [m2, y2], N2 = 0; N2 < 2; ++N2) {
      var j2 = L2[N2];
      for (k2 = 0; k2 < j2.length; ++k2) {
        var z2 = 31 & j2[k2];
        wr(i2, h2, D2[z2]), h2 += E2[z2], z2 > 15 && (wr(i2, h2, j2[k2] >>> 5 & 127), h2 += j2[k2] >>> 12);
      }
    }
  } else R2 = gr, T2 = fr, M2 = _r, C2 = pr;
  for (k2 = 0; k2 < a2; ++k2) if (r2[k2] > 255) {
    z2 = r2[k2] >>> 18 & 31;
    yr(i2, h2, R2[z2 + 257]), h2 += T2[z2 + 257], z2 > 7 && (wr(i2, h2, r2[k2] >>> 23 & 31), h2 += er[z2]);
    var U2 = 31 & r2[k2];
    yr(i2, h2, M2[U2]), h2 += C2[U2], U2 > 3 && (yr(i2, h2, r2[k2] >>> 5 & 8191), h2 += rr[U2]);
  } else yr(i2, h2, R2[r2[k2]]), h2 += T2[r2[k2]];
  return yr(i2, h2, R2[256]), h2 + T2[256];
}, Pr = new ir([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]), Rr = (function() {
  for (var t2 = new ir(256), i2 = 0; i2 < 256; ++i2) {
    for (var e2 = i2, r2 = 9; --r2; ) e2 = (1 & e2 && 3988292384) ^ e2 >>> 1;
    t2[i2] = e2;
  }
  return t2;
})(), Tr = function() {
  var t2 = 4294967295;
  return {
    p: function(i2) {
      for (var e2 = t2, r2 = 0; r2 < i2.length; ++r2) e2 = Rr[255 & e2 ^ i2[r2]] ^ e2 >>> 8;
      t2 = e2;
    },
    d: function() {
      return 4294967295 ^ t2;
    }
  };
}, Mr = function(t2, i2, e2, r2, s2) {
  return (function(t3, i3, e3, r3, s3, n2) {
    var o2 = t3.length, a2 = new Ze(r3 + o2 + 5 * (1 + Math.floor(o2 / 7e3)) + s3), l2 = a2.subarray(r3, a2.length - s3), u2 = 0;
    if (!i3 || o2 < 8) for (var h2 = 0; h2 <= o2; h2 += 65535) {
      var d2 = h2 + 65535;
      d2 < o2 ? u2 = Er(l2, u2, t3.subarray(h2, d2)) : (l2[h2] = n2, u2 = Er(l2, u2, t3.subarray(h2, o2)));
    }
    else {
      for (var v2 = Pr[i3 - 1], c2 = v2 >>> 13, f2 = 8191 & v2, p2 = (1 << e3) - 1, g2 = new tr(32768), _2 = new tr(p2 + 1), m2 = Math.ceil(e3 / 3), b2 = 2 * m2, w2 = function(i4) {
        return (t3[i4] ^ t3[i4 + 1] << m2 ^ t3[i4 + 2] << b2) & p2;
      }, y2 = new ir(25e3), S2 = new tr(288), $2 = new tr(32), k2 = 0, x2 = 0, E2 = (h2 = 0, 0), I2 = 0, P2 = 0; h2 < o2; ++h2) {
        var R2 = w2(h2), T2 = 32767 & h2, M2 = _2[R2];
        if (g2[T2] = M2, _2[R2] = T2, I2 <= h2) {
          var C2 = o2 - h2;
          if ((k2 > 7e3 || E2 > 24576) && C2 > 423) {
            u2 = Ir(t3, l2, 0, y2, S2, $2, x2, E2, P2, h2 - P2, u2), E2 = k2 = x2 = 0, P2 = h2;
            for (var O2 = 0; O2 < 286; ++O2) S2[O2] = 0;
            for (O2 = 0; O2 < 30; ++O2) $2[O2] = 0;
          }
          var F2 = 2, A2 = 0, D2 = f2, L2 = T2 - M2 & 32767;
          if (C2 > 2 && R2 == w2(h2 - L2)) for (var N2 = Math.min(c2, C2) - 1, j2 = Math.min(32767, h2), z2 = Math.min(258, C2); L2 <= j2 && --D2 && T2 != M2; ) {
            if (t3[h2 + F2] == t3[h2 + F2 - L2]) {
              for (var U2 = 0; U2 < z2 && t3[h2 + U2] == t3[h2 + U2 - L2]; ++U2) ;
              if (U2 > F2) {
                if (F2 = U2, A2 = L2, U2 > N2) break;
                var q2 = Math.min(L2, U2 - 2), B2 = 0;
                for (O2 = 0; O2 < q2; ++O2) {
                  var H2 = h2 - L2 + O2 + 32768 & 32767, W2 = H2 - g2[H2] + 32768 & 32767;
                  W2 > B2 && (B2 = W2, M2 = H2);
                }
              }
            }
            L2 += (T2 = M2) - (M2 = g2[T2]) + 32768 & 32767;
          }
          if (A2) {
            y2[E2++] = 268435456 | lr[F2] << 18 | ur[A2];
            var G2 = 31 & lr[F2], J2 = 31 & ur[A2];
            x2 += er[G2] + rr[J2], ++S2[257 + G2], ++$2[J2], I2 = h2 + F2, ++k2;
          } else y2[E2++] = t3[h2], ++S2[t3[h2]];
        }
      }
      u2 = Ir(t3, l2, n2, y2, S2, $2, x2, E2, P2, h2 - P2, u2);
    }
    return br(a2, 0, r3 + mr(u2) + s3);
  })(t2, null == i2.level ? 6 : i2.level, null == i2.mem ? Math.ceil(1.5 * Math.max(8, Math.min(13, Math.log(t2.length)))) : 12 + i2.mem, e2, r2, true);
}, Cr = function(t2, i2, e2) {
  for (; e2; ++i2) t2[i2] = e2, e2 >>>= 8;
}, Or = function(t2, i2) {
  var e2 = i2.filename;
  if (t2[0] = 31, t2[1] = 139, t2[2] = 8, t2[8] = i2.level < 2 ? 4 : 9 == i2.level ? 2 : 0, t2[9] = 3, 0 != i2.mtime && Cr(t2, 4, Math.floor(new Date(i2.mtime || Date.now()) / 1e3)), e2) {
    t2[3] = 8;
    for (var r2 = 0; r2 <= e2.length; ++r2) t2[r2 + 10] = e2.charCodeAt(r2);
  }
}, Fr = function(t2) {
  return 10 + (t2.filename && t2.filename.length + 1 || 0);
};
function Ar(t2, i2) {
  void 0 === i2 && (i2 = {});
  var e2 = Tr(), r2 = t2.length;
  e2.p(t2);
  var s2 = Mr(t2, i2, Fr(i2), 8), n2 = s2.length;
  return Or(s2, i2), Cr(s2, n2 - 8, e2.d()), Cr(s2, n2 - 4, r2), s2;
}
function Dr(t2, i2) {
  var e2 = t2.length;
  if ("undefined" != typeof TextEncoder) return new TextEncoder().encode(t2);
  for (var r2 = new Ze(t2.length + (t2.length >>> 1)), s2 = 0, n2 = function(t3) {
    r2[s2++] = t3;
  }, o2 = 0; o2 < e2; ++o2) {
    if (s2 + 5 > r2.length) {
      var a2 = new Ze(s2 + 8 + (e2 - o2 << 1));
      a2.set(r2), r2 = a2;
    }
    var l2 = t2.charCodeAt(o2);
    l2 < 128 || i2 ? n2(l2) : l2 < 2048 ? (n2(192 | l2 >>> 6), n2(128 | 63 & l2)) : l2 > 55295 && l2 < 57344 ? (n2(240 | (l2 = 65536 + (1047552 & l2) | 1023 & t2.charCodeAt(++o2)) >>> 18), n2(128 | l2 >>> 12 & 63), n2(128 | l2 >>> 6 & 63), n2(128 | 63 & l2)) : (n2(224 | l2 >>> 12), n2(128 | l2 >>> 6 & 63), n2(128 | 63 & l2));
  }
  return br(r2, 0, s2);
}
function Lr(t2, i2) {
  return (function(t3) {
    for (var i3 = 0, e2 = 0; e2 < t3.length; e2++) i3 = (i3 << 5) - i3 + t3.charCodeAt(e2), i3 |= 0;
    return Math.abs(i3);
  })(t2) % 100 < Xe(100 * i2, 0, 100);
}
var Nr = "disabled", jr = "sampled", zr = "active", Ur = "buffering", qr = "paused", Br = "trigger", Hr = Br + "_activated", Wr = Br + "_pending", Gr = Br + "_" + Nr;
function Jr(t2, i2) {
  return i2.some((i3) => "regex" === i3.matching && new RegExp(i3.url).test(t2));
}
class Vr {
  constructor(t2) {
    this.gt = t2;
  }
  triggerStatus(t2) {
    var i2 = this.gt.map((i3) => i3.triggerStatus(t2));
    return i2.includes(Hr) ? Hr : i2.includes(Wr) ? Wr : Gr;
  }
  stop() {
    this.gt.forEach((t2) => t2.stop());
  }
}
class Kr {
  constructor(t2) {
    this.gt = t2;
  }
  triggerStatus(t2) {
    var i2 = /* @__PURE__ */ new Set();
    for (var e2 of this.gt) i2.add(e2.triggerStatus(t2));
    switch (i2.delete(Gr), i2.size) {
      case 0:
        return Gr;
      case 1:
        return Array.from(i2)[0];
      default:
        return Wr;
    }
  }
  stop() {
    this.gt.forEach((t2) => t2.stop());
  }
}
class Yr {
  triggerStatus() {
    return Wr;
  }
  stop() {
  }
}
class Xr {
  constructor(t2) {
    this._t = [], this.bt = [], this.urlBlocked = false, this._instance = t2;
  }
  onRemoteConfig(t2) {
    var i2, e2;
    this._t = (null == (i2 = t2.sessionRecording) ? void 0 : i2.urlTriggers) || [], this.bt = (null == (e2 = t2.sessionRecording) ? void 0 : e2.urlBlocklist) || [];
  }
  wt(t2) {
    var i2;
    return 0 === this._t.length ? Gr : (null == (i2 = this._instance) ? void 0 : i2.get_property(xt)) === t2 ? Hr : Wr;
  }
  triggerStatus(t2) {
    var i2 = this.wt(t2), e2 = i2 === Hr ? Hr : i2 === Wr ? Wr : Gr;
    return this._instance.register_for_session({
      $sdk_debug_replay_url_trigger_status: e2
    }), e2;
  }
  checkUrlTriggerConditions(i2, e2, r2) {
    if (void 0 !== t && t.location.href) {
      var s2 = t.location.href, n2 = this.urlBlocked, o2 = Jr(s2, this.bt);
      n2 && o2 || (o2 && !n2 ? i2() : !o2 && n2 && e2(), Jr(s2, this._t) && r2("url"));
    }
  }
  stop() {
  }
}
class Qr {
  constructor(t2) {
    this.linkedFlag = null, this.linkedFlagSeen = false, this.yt = () => {
    }, this._instance = t2;
  }
  triggerStatus() {
    var t2 = Wr;
    return O(this.linkedFlag) && (t2 = Gr), this.linkedFlagSeen && (t2 = Hr), this._instance.register_for_session({
      $sdk_debug_replay_linked_flag_trigger_status: t2
    }), t2;
  }
  onRemoteConfig(t2, i2) {
    var e2;
    if (this.linkedFlag = (null == (e2 = t2.sessionRecording) ? void 0 : e2.linkedFlag) || null, !O(this.linkedFlag) && !this.linkedFlagSeen) {
      var r2 = T(this.linkedFlag) ? this.linkedFlag : this.linkedFlag.flag, s2 = T(this.linkedFlag) ? null : this.linkedFlag.variant;
      this.yt = this._instance.onFeatureFlags((t3, e3) => {
        var n2 = false;
        if (I(e3) && r2 in e3) {
          var o2 = e3[r2];
          n2 = A(o2) ? true === o2 : s2 ? o2 === s2 : !!o2;
        }
        this.linkedFlagSeen = n2, n2 && i2(r2, s2);
      });
    }
  }
  stop() {
    this.yt();
  }
}
class Zr {
  constructor(t2) {
    this.St = [], this._instance = t2;
  }
  onRemoteConfig(t2) {
    var i2;
    this.St = (null == (i2 = t2.sessionRecording) ? void 0 : i2.eventTriggers) || [];
  }
  $t(t2) {
    var i2;
    return 0 === this.St.length ? Gr : (null == (i2 = this._instance) ? void 0 : i2.get_property(Et)) === t2 ? Hr : Wr;
  }
  triggerStatus(t2) {
    var i2 = this.$t(t2), e2 = i2 === Hr ? Hr : i2 === Wr ? Wr : Gr;
    return this._instance.register_for_session({
      $sdk_debug_replay_event_trigger_status: e2
    }), e2;
  }
  stop() {
  }
}
function ts(t2) {
  return t2.isRecordingEnabled ? Ur : Nr;
}
function is(t2) {
  if (!t2.receivedDecide) return Ur;
  if (!t2.isRecordingEnabled) return Nr;
  if (t2.urlTriggerMatching.urlBlocked) return qr;
  var i2 = true === t2.isSampled, e2 = new Vr([t2.eventTriggerMatching, t2.urlTriggerMatching, t2.linkedFlagMatching]).triggerStatus(t2.sessionId);
  return i2 ? jr : e2 === Hr ? zr : e2 === Wr ? Ur : false === t2.isSampled ? Nr : zr;
}
function es(t2) {
  if (!t2.receivedDecide) return Ur;
  if (!t2.isRecordingEnabled) return Nr;
  if (t2.urlTriggerMatching.urlBlocked) return qr;
  var i2 = new Kr([t2.eventTriggerMatching, t2.urlTriggerMatching, t2.linkedFlagMatching]).triggerStatus(t2.sessionId), e2 = i2 !== Gr, r2 = A(t2.isSampled);
  return e2 && i2 === Wr ? Ur : e2 && i2 === Gr || r2 && !t2.isSampled ? Nr : true === t2.isSampled ? jr : zr;
}
var rs = "[SessionRecording]", ss = z(rs);
function ns() {
  var t2;
  return null == v || null == (t2 = v.__PosthogExtensions__) || null == (t2 = t2.rrweb) ? void 0 : t2.record;
}
var os = 3e5, as = [Ue.MouseMove, Ue.MouseInteraction, Ue.Scroll, Ue.ViewportResize, Ue.Input, Ue.TouchMove, Ue.MediaInteraction, Ue.Drag], ls = (t2) => ({
  rrwebMethod: t2,
  enqueuedAt: Date.now(),
  attempt: 1
});
function us(t2) {
  return (function(t3, i2) {
    for (var e2 = "", r2 = 0; r2 < t3.length; ) {
      var s2 = t3[r2++];
      e2 += String.fromCharCode(s2);
    }
    return e2;
  })(Ar(Dr(JSON.stringify(t2))));
}
function hs(t2) {
  return t2.type === ze.Custom && "sessionIdle" === t2.data.tag;
}
class ds {
  get sessionId() {
    return this.kt;
  }
  get xt() {
    return this._instance.config.session_recording.session_idle_threshold_ms || 3e5;
  }
  get started() {
    return this.Et;
  }
  get It() {
    if (!this._instance.sessionManager) throw new Error(rs + " must be started with a valid sessionManager.");
    return this._instance.sessionManager;
  }
  get Pt() {
    var t2, i2;
    return this.Rt.triggerStatus(this.sessionId) === Wr ? 6e4 : null !== (t2 = null == (i2 = this._instance.config.session_recording) ? void 0 : i2.full_snapshot_interval_millis) && void 0 !== t2 ? t2 : os;
  }
  get Tt() {
    var t2 = this._instance.get_property(kt);
    return A(t2) ? t2 : null;
  }
  get Mt() {
    var t2, i2, e2 = null == (t2 = this.M) ? void 0 : t2.data[(null == (i2 = this.M) ? void 0 : i2.data.length) - 1], {
      sessionStartTimestamp: r2
    } = this.It.checkAndGetSessionAndWindowId(true);
    return e2 ? e2.timestamp - r2 : null;
  }
  get Ct() {
    var i2 = !!this._instance.get_property(pt), e2 = !this._instance.config.disable_session_recording;
    return t && i2 && e2;
  }
  get Ot() {
    var t2 = !!this._instance.get_property(gt), i2 = this._instance.config.enable_recording_console_log;
    return null != i2 ? i2 : t2;
  }
  get Ft() {
    var t2, i2, e2, r2, s2, n2, o2 = this._instance.config.session_recording.captureCanvas, a2 = this._instance.get_property(bt), l2 = null !== (t2 = null !== (i2 = null == o2 ? void 0 : o2.recordCanvas) && void 0 !== i2 ? i2 : null == a2 ? void 0 : a2.enabled) && void 0 !== t2 && t2, u2 = null !== (e2 = null !== (r2 = null == o2 ? void 0 : o2.canvasFps) && void 0 !== r2 ? r2 : null == a2 ? void 0 : a2.fps) && void 0 !== e2 ? e2 : 4, h2 = null !== (s2 = null !== (n2 = null == o2 ? void 0 : o2.canvasQuality) && void 0 !== n2 ? n2 : null == a2 ? void 0 : a2.quality) && void 0 !== s2 ? s2 : 0.4;
    if ("string" == typeof h2) {
      var d2 = parseFloat(h2);
      h2 = isNaN(d2) ? 0.4 : d2;
    }
    return {
      enabled: l2,
      fps: Xe(u2, 0, 12, "canvas recording fps", 4),
      quality: Xe(h2, 0, 1, "canvas recording quality", 0.4)
    };
  }
  get At() {
    var t2, i2, e2 = this._instance.get_property(_t), r2 = {
      recordHeaders: null == (t2 = this._instance.config.session_recording) ? void 0 : t2.recordHeaders,
      recordBody: null == (i2 = this._instance.config.session_recording) ? void 0 : i2.recordBody
    }, s2 = (null == r2 ? void 0 : r2.recordHeaders) || (null == e2 ? void 0 : e2.recordHeaders), n2 = (null == r2 ? void 0 : r2.recordBody) || (null == e2 ? void 0 : e2.recordBody), o2 = I(this._instance.config.capture_performance) ? this._instance.config.capture_performance.network_timing : this._instance.config.capture_performance, a2 = !!(A(o2) ? o2 : null == e2 ? void 0 : e2.capturePerformance);
    return s2 || n2 || a2 ? {
      recordHeaders: s2,
      recordBody: n2,
      recordPerformance: a2
    } : void 0;
  }
  get Dt() {
    var t2, i2, e2, r2, s2, n2, o2 = this._instance.get_property(mt), a2 = {
      maskAllInputs: null == (t2 = this._instance.config.session_recording) ? void 0 : t2.maskAllInputs,
      maskTextSelector: null == (i2 = this._instance.config.session_recording) ? void 0 : i2.maskTextSelector,
      blockSelector: null == (e2 = this._instance.config.session_recording) ? void 0 : e2.blockSelector
    }, l2 = null !== (r2 = null == a2 ? void 0 : a2.maskAllInputs) && void 0 !== r2 ? r2 : null == o2 ? void 0 : o2.maskAllInputs, u2 = null !== (s2 = null == a2 ? void 0 : a2.maskTextSelector) && void 0 !== s2 ? s2 : null == o2 ? void 0 : o2.maskTextSelector, h2 = null !== (n2 = null == a2 ? void 0 : a2.blockSelector) && void 0 !== n2 ? n2 : null == o2 ? void 0 : o2.blockSelector;
    return R(l2) && R(u2) && R(h2) ? void 0 : {
      maskAllInputs: null == l2 || l2,
      maskTextSelector: u2,
      blockSelector: h2
    };
  }
  get Lt() {
    var t2 = this._instance.get_property(wt);
    return F(t2) ? t2 : null;
  }
  get Nt() {
    var t2 = this._instance.get_property(yt);
    return F(t2) ? t2 : null;
  }
  get status() {
    return this.jt ? this.zt({
      receivedDecide: this.jt,
      isRecordingEnabled: this.Ct,
      isSampled: this.Tt,
      urlTriggerMatching: this.Ut,
      eventTriggerMatching: this.qt,
      linkedFlagMatching: this.Bt,
      sessionId: this.sessionId
    }) : Ur;
  }
  constructor(t2) {
    if (this.zt = ts, this.jt = false, this.Ht = [], this.Wt = "unknown", this.Gt = Date.now(), this.Rt = new Yr(), this.Jt = void 0, this.Vt = void 0, this.Kt = void 0, this.Yt = void 0, this.Xt = void 0, this._forceAllowLocalhostNetworkCapture = false, this.Qt = () => {
      this.Zt();
    }, this.ti = () => {
      this.ii("browser offline", {});
    }, this.ei = () => {
      this.ii("browser online", {});
    }, this.ri = () => {
      if (null != o && o.visibilityState) {
        var t3 = "window " + o.visibilityState;
        this.ii(t3, {});
      }
    }, this._instance = t2, this.Et = false, this.si = "/s/", this.ni = void 0, this.jt = false, !this._instance.sessionManager) throw ss.error("started without valid sessionManager"), new Error(rs + " started without valid sessionManager. This is a bug.");
    if (this._instance.config.__preview_experimental_cookieless_mode) throw new Error(rs + " cannot be used with __preview_experimental_cookieless_mode.");
    this.Bt = new Qr(this._instance), this.Ut = new Xr(this._instance), this.qt = new Zr(this._instance);
    var {
      sessionId: i2,
      windowId: e2
    } = this.It.checkAndGetSessionAndWindowId();
    this.kt = i2, this.oi = e2, this.M = this.ai(), this.xt >= this.It.sessionTimeoutMs && ss.warn("session_idle_threshold_ms (" + this.xt + ") is greater than the session timeout (" + this.It.sessionTimeoutMs + "). Session will never be detected as idle");
  }
  startIfEnabledOrStop(i2) {
    this.Ct ? (this.li(i2), st(t, "beforeunload", this.Qt), st(t, "offline", this.ti), st(t, "online", this.ei), st(t, "visibilitychange", this.ri), this.ui(), this.hi(), O(this.Jt) && (this.Jt = this._instance.on("eventCaptured", (t2) => {
      try {
        if ("$pageview" === t2.event) {
          var i3 = null != t2 && t2.properties.$current_url ? this.di(null == t2 ? void 0 : t2.properties.$current_url) : "";
          if (!i3) return;
          this.ii("$pageview", {
            href: i3
          });
        }
      } catch (t3) {
        ss.error("Could not add $pageview to rrweb session", t3);
      }
    })), this.Vt || (this.Vt = this.It.onSessionId((t2, i3, e2) => {
      var r2, s2;
      e2 && (this.ii("$session_id_change", {
        sessionId: t2,
        windowId: i3,
        changeReason: e2
      }), null == (r2 = this._instance) || null == (r2 = r2.persistence) || r2.unregister(Et), null == (s2 = this._instance) || null == (s2 = s2.persistence) || s2.unregister(xt));
    }))) : this.stopRecording();
  }
  stopRecording() {
    var i2, e2, r2, s2;
    this.Et && this.ni && (this.ni(), this.ni = void 0, this.Et = false, null == t || t.removeEventListener("beforeunload", this.Qt), null == t || t.removeEventListener("offline", this.ti), null == t || t.removeEventListener("online", this.ei), null == t || t.removeEventListener("visibilitychange", this.ri), this.ai(), clearInterval(this.vi), null == (i2 = this.Jt) || i2.call(this), this.Jt = void 0, null == (e2 = this.Xt) || e2.call(this), this.Xt = void 0, null == (r2 = this.Vt) || r2.call(this), this.Vt = void 0, null == (s2 = this.Yt) || s2.call(this), this.Yt = void 0, this.qt.stop(), this.Ut.stop(), this.Bt.stop(), ss.info("stopped"));
  }
  ci() {
    var t2;
    null == (t2 = this._instance.persistence) || t2.unregister(kt);
  }
  fi(t2) {
    var i2, e2 = this.kt !== t2, r2 = this.Lt;
    if (F(r2)) {
      var s2 = this.Tt, n2 = e2 || !A(s2), o2 = n2 ? Lr(t2, r2) : s2;
      n2 && (o2 ? this.pi(jr) : ss.warn("Sample rate (" + r2 + ") has determined that this sessionId (" + t2 + ") will not be sent to the server."), this.ii("samplingDecisionMade", {
        sampleRate: r2,
        isSampled: o2
      })), null == (i2 = this._instance.persistence) || i2.register({
        [kt]: o2
      });
    } else this.ci();
  }
  onRemoteConfig(t2) {
    var i2, e2, r2, s2;
    (this.ii("$remote_config_received", t2), this.gi(t2), null != (i2 = t2.sessionRecording) && i2.endpoint) && (this.si = null == (s2 = t2.sessionRecording) ? void 0 : s2.endpoint);
    this.ui(), "any" === (null == (e2 = t2.sessionRecording) ? void 0 : e2.triggerMatchType) ? (this.zt = is, this.Rt = new Vr([this.qt, this.Ut])) : (this.zt = es, this.Rt = new Kr([this.qt, this.Ut])), this._instance.register_for_session({
      $sdk_debug_replay_remote_trigger_matching_config: null == (r2 = t2.sessionRecording) ? void 0 : r2.triggerMatchType
    }), this.Ut.onRemoteConfig(t2), this.qt.onRemoteConfig(t2), this.Bt.onRemoteConfig(t2, (t3, i3) => {
      this.pi("linked_flag_matched", {
        flag: t3,
        variant: i3
      });
    }), this.jt = true, this.startIfEnabledOrStop();
  }
  ui() {
    F(this.Lt) && O(this.Yt) && (this.Yt = this.It.onSessionId((t2) => {
      this.fi(t2);
    }));
  }
  gi(t2) {
    if (this._instance.persistence) {
      var i2, e2 = this._instance.persistence, r2 = () => {
        var i3, r3, s2, n2, o2, a2, l2, u2, h2, d2 = null == (i3 = t2.sessionRecording) ? void 0 : i3.sampleRate, v2 = O(d2) ? null : parseFloat(d2);
        O(v2) && this.ci();
        var c2 = null == (r3 = t2.sessionRecording) ? void 0 : r3.minimumDurationMilliseconds;
        e2.register({
          [pt]: !!t2.sessionRecording,
          [gt]: null == (s2 = t2.sessionRecording) ? void 0 : s2.consoleLogRecordingEnabled,
          [_t]: B({
            capturePerformance: t2.capturePerformance
          }, null == (n2 = t2.sessionRecording) ? void 0 : n2.networkPayloadCapture),
          [mt]: null == (o2 = t2.sessionRecording) ? void 0 : o2.masking,
          [bt]: {
            enabled: null == (a2 = t2.sessionRecording) ? void 0 : a2.recordCanvas,
            fps: null == (l2 = t2.sessionRecording) ? void 0 : l2.canvasFps,
            quality: null == (u2 = t2.sessionRecording) ? void 0 : u2.canvasQuality
          },
          [wt]: v2,
          [yt]: R(c2) ? null : c2,
          [St]: null == (h2 = t2.sessionRecording) ? void 0 : h2.scriptConfig
        });
      };
      r2(), null == (i2 = this.Kt) || i2.call(this), this.Kt = this.It.onSessionId(r2);
    }
  }
  log(t2, i2) {
    var e2;
    void 0 === i2 && (i2 = "log"), null == (e2 = this._instance.sessionRecording) || e2.onRRwebEmit({
      type: 6,
      data: {
        plugin: "rrweb/console@1",
        payload: {
          level: i2,
          trace: [],
          payload: [JSON.stringify(t2)]
        }
      },
      timestamp: Date.now()
    });
  }
  li(t2) {
    if (!R(Object.assign) && !R(Array.from) && !(this.Et || this._instance.config.disable_session_recording || this._instance.consent.isOptedOut())) {
      var i2;
      if (this.Et = true, this.It.checkAndGetSessionAndWindowId(), ns()) this.mi();
      else null == (i2 = v.__PosthogExtensions__) || null == i2.loadExternalDependency || i2.loadExternalDependency(this._instance, this.bi, (t3) => {
        if (t3) return ss.error("could not load recorder", t3);
        this.mi();
      });
      ss.info("starting"), this.status === zr && this.pi(t2 || "recording_initialized");
    }
  }
  get bi() {
    var t2;
    return (null == (t2 = this._instance) || null == (t2 = t2.persistence) || null == (t2 = t2.get_property(St)) ? void 0 : t2.script) || "recorder";
  }
  wi(t2) {
    var i2;
    return 3 === t2.type && -1 !== as.indexOf(null == (i2 = t2.data) ? void 0 : i2.source);
  }
  yi(t2) {
    var i2 = this.wi(t2);
    i2 || this.Wt || t2.timestamp - this.Gt > this.xt && (this.Wt = true, clearInterval(this.vi), this.ii("sessionIdle", {
      eventTimestamp: t2.timestamp,
      lastActivityTimestamp: this.Gt,
      threshold: this.xt,
      bufferLength: this.M.data.length,
      bufferSize: this.M.size
    }), this.Zt());
    var e2 = false;
    if (i2 && (this.Gt = t2.timestamp, this.Wt)) {
      var r2 = "unknown" === this.Wt;
      this.Wt = false, r2 || (this.ii("sessionNoLongerIdle", {
        reason: "user activity",
        type: t2.type
      }), e2 = true);
    }
    if (!this.Wt) {
      var {
        windowId: s2,
        sessionId: n2
      } = this.It.checkAndGetSessionAndWindowId(!i2, t2.timestamp), o2 = this.kt !== n2, a2 = this.oi !== s2;
      this.oi = s2, this.kt = n2, o2 || a2 ? (this.stopRecording(), this.startIfEnabledOrStop("session_id_changed")) : e2 && this.Si();
    }
  }
  $i(t2) {
    try {
      return t2.rrwebMethod(), true;
    } catch (i2) {
      return this.Ht.length < 10 ? this.Ht.push({
        enqueuedAt: t2.enqueuedAt || Date.now(),
        attempt: t2.attempt++,
        rrwebMethod: t2.rrwebMethod
      }) : ss.warn("could not emit queued rrweb event.", i2, t2), false;
    }
  }
  ii(t2, i2) {
    return this.$i(ls(() => ns().addCustomEvent(t2, i2)));
  }
  ki() {
    return this.$i(ls(() => ns().takeFullSnapshot()));
  }
  mi() {
    var t2, i2, e2, r2, s2 = {
      blockClass: "ph-no-capture",
      blockSelector: void 0,
      ignoreClass: "ph-ignore-input",
      maskTextClass: "ph-mask",
      maskTextSelector: void 0,
      maskTextFn: void 0,
      maskAllInputs: true,
      maskInputOptions: {
        password: true
      },
      maskInputFn: void 0,
      slimDOMOptions: {},
      collectFonts: false,
      inlineStylesheet: true,
      recordCrossOriginIframes: false
    }, n2 = this._instance.config.session_recording;
    for (var [o2, a2] of Object.entries(n2 || {})) o2 in s2 && ("maskInputOptions" === o2 ? s2.maskInputOptions = B({
      password: true
    }, a2) : s2[o2] = a2);
    (this.Ft && this.Ft.enabled && (s2.recordCanvas = true, s2.sampling = {
      canvas: this.Ft.fps
    }, s2.dataURLOptions = {
      type: "image/webp",
      quality: this.Ft.quality
    }), this.Dt) && (s2.maskAllInputs = null === (i2 = this.Dt.maskAllInputs) || void 0 === i2 || i2, s2.maskTextSelector = null !== (e2 = this.Dt.maskTextSelector) && void 0 !== e2 ? e2 : void 0, s2.blockSelector = null !== (r2 = this.Dt.blockSelector) && void 0 !== r2 ? r2 : void 0);
    var l2 = ns();
    if (l2) {
      this.xi = null !== (t2 = this.xi) && void 0 !== t2 ? t2 : new Qe(l2, {
        refillRate: this._instance.config.session_recording.__mutationRateLimiterRefillRate,
        bucketSize: this._instance.config.session_recording.__mutationRateLimiterBucketSize,
        onBlockedNode: (t3, i3) => {
          var e3 = "Too many mutations on node '" + t3 + "'. Rate limiting. This could be due to SVG animations or something similar";
          ss.info(e3, {
            node: i3
          }), this.log(rs + " " + e3, "warn");
        }
      });
      var u2 = this.Ei();
      this.ni = l2(B({
        emit: (t3) => {
          this.onRRwebEmit(t3);
        },
        plugins: u2
      }, s2)), this.Gt = Date.now(), this.Wt = A(this.Wt) ? this.Wt : "unknown", this.ii("$session_options", {
        sessionRecordingOptions: s2,
        activePlugins: u2.map((t3) => null == t3 ? void 0 : t3.name)
      }), this.ii("$posthog_config", {
        config: this._instance.config
      });
    } else ss.error("onScriptLoaded was called but rrwebRecord is not available. This indicates something has gone wrong.");
  }
  Si() {
    if (this.vi && clearInterval(this.vi), true !== this.Wt) {
      var t2 = this.Pt;
      t2 && (this.vi = setInterval(() => {
        this.ki();
      }, t2));
    }
  }
  Ei() {
    var t2, i2, e2 = [], r2 = null == (t2 = v.__PosthogExtensions__) || null == (t2 = t2.rrwebPlugins) ? void 0 : t2.getRecordConsolePlugin;
    r2 && this.Ot && e2.push(r2());
    var s2 = null == (i2 = v.__PosthogExtensions__) || null == (i2 = i2.rrwebPlugins) ? void 0 : i2.getRecordNetworkPlugin;
    this.At && E(s2) && (!wi.includes(location.hostname) || this._forceAllowLocalhostNetworkCapture ? e2.push(s2(Ye(this._instance.config, this.At))) : ss.info("NetworkCapture not started because we are on localhost."));
    return e2;
  }
  onRRwebEmit(t2) {
    var i2;
    if (this.Ii(), t2 && I(t2)) {
      if (t2.type === ze.Meta) {
        var e2 = this.di(t2.data.href);
        if (this.Pi = e2, !e2) return;
        t2.data.href = e2;
      } else this.Ri();
      if (this.Ut.checkUrlTriggerConditions(() => this.Ti(), () => this.Mi(), (t3) => this.Ci(t3)), !this.Ut.urlBlocked || (r2 = t2).type === ze.Custom && "recording paused" === r2.data.tag) {
        var r2;
        t2.type === ze.FullSnapshot && this.Si(), t2.type === ze.FullSnapshot && this.jt && this.Rt.triggerStatus(this.sessionId) === Wr && this.ai();
        var s2 = this.xi ? this.xi.throttleMutations(t2) : t2;
        if (s2) {
          var n2 = (function(t3) {
            var i3 = t3;
            if (i3 && I(i3) && 6 === i3.type && I(i3.data) && "rrweb/console@1" === i3.data.plugin) {
              i3.data.payload.payload.length > 10 && (i3.data.payload.payload = i3.data.payload.payload.slice(0, 10), i3.data.payload.payload.push("...[truncated]"));
              for (var e3 = [], r3 = 0; r3 < i3.data.payload.payload.length; r3++) i3.data.payload.payload[r3] && i3.data.payload.payload[r3].length > 2e3 ? e3.push(i3.data.payload.payload[r3].slice(0, 2e3) + "...[truncated]") : e3.push(i3.data.payload.payload[r3]);
              return i3.data.payload.payload = e3, t3;
            }
            return t3;
          })(s2);
          if (this.yi(n2), true !== this.Wt || hs(n2)) {
            if (hs(n2)) {
              var o2 = n2.data.payload;
              if (o2) {
                var a2 = o2.lastActivityTimestamp, l2 = o2.threshold;
                n2.timestamp = a2 + l2;
              }
            }
            var u2 = null === (i2 = this._instance.config.session_recording.compress_events) || void 0 === i2 || i2 ? (function(t3) {
              if (Ne(t3) < 1024) return t3;
              try {
                if (t3.type === ze.FullSnapshot) return B({}, t3, {
                  data: us(t3.data),
                  cv: "2024-10"
                });
                if (t3.type === ze.IncrementalSnapshot && t3.data.source === Ue.Mutation) return B({}, t3, {
                  cv: "2024-10",
                  data: B({}, t3.data, {
                    texts: us(t3.data.texts),
                    attributes: us(t3.data.attributes),
                    removes: us(t3.data.removes),
                    adds: us(t3.data.adds)
                  })
                });
                if (t3.type === ze.IncrementalSnapshot && t3.data.source === Ue.StyleSheetRule) return B({}, t3, {
                  cv: "2024-10",
                  data: B({}, t3.data, {
                    adds: t3.data.adds ? us(t3.data.adds) : void 0,
                    removes: t3.data.removes ? us(t3.data.removes) : void 0
                  })
                });
              } catch (t4) {
                ss.error("could not compress event - will use uncompressed event", t4);
              }
              return t3;
            })(n2) : n2, h2 = {
              $snapshot_bytes: Ne(u2),
              $snapshot_data: u2,
              $session_id: this.kt,
              $window_id: this.oi
            };
            this.status !== Nr ? this.Oi(h2) : this.ai();
          }
        }
      }
    }
  }
  Ri() {
    if (!this._instance.config.capture_pageview && t) {
      var i2 = this.di(t.location.href);
      this.Pi !== i2 && (this.ii("$url_changed", {
        href: i2
      }), this.Pi = i2);
    }
  }
  Ii() {
    if (this.Ht.length) {
      var t2 = [...this.Ht];
      this.Ht = [], t2.forEach((t3) => {
        Date.now() - t3.enqueuedAt <= 2e3 && this.$i(t3);
      });
    }
  }
  di(t2) {
    var i2 = this._instance.config.session_recording;
    if (i2.maskNetworkRequestFn) {
      var e2, r2 = {
        url: t2
      };
      return null == (e2 = r2 = i2.maskNetworkRequestFn(r2)) ? void 0 : e2.url;
    }
    return t2;
  }
  ai() {
    return this.M = {
      size: 0,
      data: [],
      sessionId: this.kt,
      windowId: this.oi
    }, this.M;
  }
  Zt() {
    this.Fi && (clearTimeout(this.Fi), this.Fi = void 0);
    var t2 = this.Nt, i2 = this.Mt, e2 = F(i2) && i2 >= 0, r2 = F(t2) && e2 && i2 < t2;
    if (this.status === Ur || this.status === qr || this.status === Nr || r2) return this.Fi = setTimeout(() => {
      this.Zt();
    }, 2e3), this.M;
    this.M.data.length > 0 && je(this.M).forEach((t3) => {
      this.Ai({
        $snapshot_bytes: t3.size,
        $snapshot_data: t3.data,
        $session_id: t3.sessionId,
        $window_id: t3.windowId,
        $lib: "web",
        $lib_version: c.LIB_VERSION
      });
    });
    return this.ai();
  }
  Oi(t2) {
    var i2, e2 = 2 + ((null == (i2 = this.M) ? void 0 : i2.data.length) || 0);
    !this.Wt && (this.M.size + t2.$snapshot_bytes + e2 > 943718.4 || this.M.sessionId !== this.kt) && (this.M = this.Zt()), this.M.size += t2.$snapshot_bytes, this.M.data.push(t2.$snapshot_data), this.Fi || this.Wt || (this.Fi = setTimeout(() => {
      this.Zt();
    }, 2e3));
  }
  Ai(t2) {
    this._instance.capture("$snapshot", t2, {
      _url: this._instance.requestRouter.endpointFor("api", this.si),
      _noTruncate: true,
      _batchKey: "recordings",
      skip_client_rate_limiting: true
    });
  }
  Ci(t2) {
    var i2;
    this.Rt.triggerStatus(this.sessionId) === Wr && (null == (i2 = this._instance) || null == (i2 = i2.persistence) || i2.register({
      ["url" === t2 ? xt : Et]: this.kt
    }), this.Zt(), this.pi(t2 + "_trigger_matched"));
  }
  Ti() {
    this.Ut.urlBlocked || (this.Ut.urlBlocked = true, clearInterval(this.vi), ss.info("recording paused due to URL blocker"), this.ii("recording paused", {
      reason: "url blocker"
    }));
  }
  Mi() {
    this.Ut.urlBlocked && (this.Ut.urlBlocked = false, this.ki(), this.Si(), this.ii("recording resumed", {
      reason: "left blocked url"
    }), ss.info("recording resumed"));
  }
  hi() {
    0 !== this.qt.St.length && O(this.Xt) && (this.Xt = this._instance.on("eventCaptured", (t2) => {
      try {
        this.qt.St.includes(t2.event) && this.Ci("event");
      } catch (t3) {
        ss.error("Could not activate event trigger", t3);
      }
    }));
  }
  overrideLinkedFlag() {
    this.Bt.linkedFlagSeen = true, this.ki(), this.pi("linked_flag_overridden");
  }
  overrideSampling() {
    var t2;
    null == (t2 = this._instance.persistence) || t2.register({
      [kt]: true
    }), this.ki(), this.pi("sampling_overridden");
  }
  overrideTrigger(t2) {
    this.Ci(t2);
  }
  pi(t2, i2) {
    this._instance.register_for_session({
      $session_recording_start_reason: t2
    }), ss.info(t2.replace("_", " "), i2), m(["recording_initialized", "session_id_changed"], t2) || this.ii(t2, i2);
  }
  get sdkDebugProperties() {
    var {
      sessionStartTimestamp: t2
    } = this.It.checkAndGetSessionAndWindowId(true);
    return {
      $recording_status: this.status,
      $sdk_debug_replay_internal_buffer_length: this.M.data.length,
      $sdk_debug_replay_internal_buffer_size: this.M.size,
      $sdk_debug_current_session_duration: this.Mt,
      $sdk_debug_session_start: t2
    };
  }
}
var vs = z("[SegmentIntegration]");
function cs(t2, i2) {
  var e2 = t2.config.segment;
  if (!e2) return i2();
  !(function(t3, i3) {
    var e3 = t3.config.segment;
    if (!e3) return i3();
    var r2 = (e4) => {
      var r3 = () => e4.anonymousId() || Ni();
      t3.config.get_device_id = r3, e4.id() && (t3.register({
        distinct_id: e4.id(),
        $device_id: r3()
      }), t3.persistence.set_property(At, "identified")), i3();
    }, s2 = e3.user();
    "then" in s2 && E(s2.then) ? s2.then((t4) => r2(t4)) : r2(s2);
  })(t2, () => {
    e2.register(((t3) => {
      Promise && Promise.resolve || vs.warn("This browser does not have Promise support, and can not use the segment integration");
      var i3 = (i4, e3) => {
        if (!e3) return i4;
        i4.event.userId || i4.event.anonymousId === t3.get_distinct_id() || (vs.info("No userId set, resetting PostHog"), t3.reset()), i4.event.userId && i4.event.userId !== t3.get_distinct_id() && (vs.info("UserId set, identifying with PostHog"), t3.identify(i4.event.userId));
        var r2 = t3.calculateEventProperties(e3, i4.event.properties);
        return i4.event.properties = Object.assign({}, r2, i4.event.properties), i4;
      };
      return {
        name: "PostHog JS",
        type: "enrichment",
        version: "1.0.0",
        isLoaded: () => true,
        load: () => Promise.resolve(),
        track: (t4) => i3(t4, t4.event.event),
        page: (t4) => i3(t4, "$pageview"),
        identify: (t4) => i3(t4, "$identify"),
        screen: (t4) => i3(t4, "$screen")
      };
    })(t2)).then(() => {
      i2();
    });
  });
}
var fs = "posthog-js";
function ps(t2, i2) {
  var {
    organization: e2,
    projectId: r2,
    prefix: s2,
    severityAllowList: n2 = ["error"]
  } = void 0 === i2 ? {} : i2;
  return (i3) => {
    var o2, a2, l2, u2, h2;
    if (!("*" === n2 || n2.includes(i3.level)) || !t2.__loaded) return i3;
    i3.tags || (i3.tags = {});
    var d2 = t2.requestRouter.endpointFor("ui", "/project/" + t2.config.token + "/person/" + t2.get_distinct_id());
    i3.tags["PostHog Person URL"] = d2, t2.sessionRecordingStarted() && (i3.tags["PostHog Recording URL"] = t2.get_session_replay_url({
      withTimestamp: true
    }));
    var v2 = (null == (o2 = i3.exception) ? void 0 : o2.values) || [], c2 = v2.map((t3) => B({}, t3, {
      stacktrace: t3.stacktrace ? B({}, t3.stacktrace, {
        type: "raw",
        frames: (t3.stacktrace.frames || []).map((t4) => B({}, t4, {
          platform: "web:javascript"
        }))
      }) : void 0
    })), f2 = {
      $exception_message: (null == (a2 = v2[0]) ? void 0 : a2.value) || i3.message,
      $exception_type: null == (l2 = v2[0]) ? void 0 : l2.type,
      $exception_personURL: d2,
      $exception_level: i3.level,
      $exception_list: c2,
      $sentry_event_id: i3.event_id,
      $sentry_exception: i3.exception,
      $sentry_exception_message: (null == (u2 = v2[0]) ? void 0 : u2.value) || i3.message,
      $sentry_exception_type: null == (h2 = v2[0]) ? void 0 : h2.type,
      $sentry_tags: i3.tags
    };
    return e2 && r2 && (f2.$sentry_url = (s2 || "https://sentry.io/organizations/") + e2 + "/issues/?project=" + r2 + "&query=" + i3.event_id), t2.exceptions.sendExceptionEvent(f2), i3;
  };
}
class gs {
  constructor(t2, i2, e2, r2, s2) {
    this.name = fs, this.setupOnce = function(n2) {
      n2(ps(t2, {
        organization: i2,
        projectId: e2,
        prefix: r2,
        severityAllowList: s2
      }));
    };
  }
}
var _s = null != t && t.location ? xi(t.location.hash, "__posthog") || xi(location.hash, "state") : null, ms = "_postHogToolbarParams", bs = z("[Toolbar]"), ws = (function(t2) {
  return t2[t2.UNINITIALIZED = 0] = "UNINITIALIZED", t2[t2.LOADING = 1] = "LOADING", t2[t2.LOADED = 2] = "LOADED", t2;
})(ws || {});
class ys {
  constructor(t2) {
    this.instance = t2;
  }
  Di(t2) {
    v.ph_toolbar_state = t2;
  }
  Li() {
    var t2;
    return null !== (t2 = v.ph_toolbar_state) && void 0 !== t2 ? t2 : ws.UNINITIALIZED;
  }
  maybeLoadToolbar(i2, e2, r2) {
    if (void 0 === i2 && (i2 = void 0), void 0 === e2 && (e2 = void 0), void 0 === r2 && (r2 = void 0), !t || !o) return false;
    i2 = null != i2 ? i2 : t.location, r2 = null != r2 ? r2 : t.history;
    try {
      if (!e2) {
        try {
          t.localStorage.setItem("test", "test"), t.localStorage.removeItem("test");
        } catch (t2) {
          return false;
        }
        e2 = null == t ? void 0 : t.localStorage;
      }
      var s2, n2 = _s || xi(i2.hash, "__posthog") || xi(i2.hash, "state"), a2 = n2 ? X(() => JSON.parse(atob(decodeURIComponent(n2)))) || X(() => JSON.parse(decodeURIComponent(n2))) : null;
      return a2 && "ph_authorize" === a2.action ? ((s2 = a2).source = "url", s2 && Object.keys(s2).length > 0 && (a2.desiredHash ? i2.hash = a2.desiredHash : r2 ? r2.replaceState(r2.state, "", i2.pathname + i2.search) : i2.hash = "")) : ((s2 = JSON.parse(e2.getItem(ms) || "{}")).source = "localstorage", delete s2.userIntent), !(!s2.token || this.instance.config.token !== s2.token) && (this.loadToolbar(s2), true);
    } catch (t2) {
      return false;
    }
  }
  Ni(t2) {
    var i2 = v.ph_load_toolbar || v.ph_load_editor;
    !O(i2) && E(i2) ? i2(t2, this.instance) : bs.warn("No toolbar load function found");
  }
  loadToolbar(i2) {
    var e2 = !(null == o || !o.getElementById(qt));
    if (!t || e2) return false;
    var r2 = "custom" === this.instance.requestRouter.region && this.instance.config.advanced_disable_toolbar_metrics, s2 = B({
      token: this.instance.config.token
    }, i2, {
      apiURL: this.instance.requestRouter.endpointFor("ui")
    }, r2 ? {
      instrument: false
    } : {});
    if (t.localStorage.setItem(ms, JSON.stringify(B({}, s2, {
      source: void 0
    }))), this.Li() === ws.LOADED) this.Ni(s2);
    else if (this.Li() === ws.UNINITIALIZED) {
      var n2;
      this.Di(ws.LOADING), null == (n2 = v.__PosthogExtensions__) || null == n2.loadExternalDependency || n2.loadExternalDependency(this.instance, "toolbar", (t2) => {
        if (t2) return bs.error("[Toolbar] Failed to load", t2), void this.Di(ws.UNINITIALIZED);
        this.Di(ws.LOADED), this.Ni(s2);
      }), st(t, "turbolinks:load", () => {
        this.Di(ws.UNINITIALIZED), this.loadToolbar(s2);
      });
    }
    return true;
  }
  ji(t2) {
    return this.loadToolbar(t2);
  }
  maybeLoadEditor(t2, i2, e2) {
    return void 0 === t2 && (t2 = void 0), void 0 === i2 && (i2 = void 0), void 0 === e2 && (e2 = void 0), this.maybeLoadToolbar(t2, i2, e2);
  }
}
var Ss = z("[TracingHeaders]");
class $s {
  constructor(t2) {
    this.zi = void 0, this.Ui = void 0, this.V = () => {
      var t3, i2;
      R(this.zi) && (null == (t3 = v.__PosthogExtensions__) || null == (t3 = t3.tracingHeadersPatchFns) || t3._patchXHR(this._instance.sessionManager));
      R(this.Ui) && (null == (i2 = v.__PosthogExtensions__) || null == (i2 = i2.tracingHeadersPatchFns) || i2._patchFetch(this._instance.sessionManager));
    }, this._instance = t2;
  }
  G(t2) {
    var i2, e2;
    null != (i2 = v.__PosthogExtensions__) && i2.tracingHeadersPatchFns && t2(), null == (e2 = v.__PosthogExtensions__) || null == e2.loadExternalDependency || e2.loadExternalDependency(this._instance, "tracing-headers", (i3) => {
      if (i3) return Ss.error("failed to load script", i3);
      t2();
    });
  }
  startIfEnabledOrStop() {
    var t2, i2;
    this._instance.config.__add_tracing_headers ? this.G(this.V) : (null == (t2 = this.zi) || t2.call(this), null == (i2 = this.Ui) || i2.call(this), this.zi = void 0, this.Ui = void 0);
  }
}
var ks = z("[Web Vitals]"), xs = 9e5;
class Es {
  constructor(t2) {
    var i2;
    this.qi = false, this.i = false, this.M = {
      url: void 0,
      metrics: [],
      firstMetricTimestamp: void 0
    }, this.Bi = () => {
      clearTimeout(this.Hi), 0 !== this.M.metrics.length && (this._instance.capture("$web_vitals", this.M.metrics.reduce((t3, i3) => B({}, t3, {
        ["$web_vitals_" + i3.name + "_event"]: B({}, i3),
        ["$web_vitals_" + i3.name + "_value"]: i3.value
      }), {})), this.M = {
        url: void 0,
        metrics: [],
        firstMetricTimestamp: void 0
      });
    }, this.Wi = (t3) => {
      var i3, e2 = null == (i3 = this._instance.sessionManager) ? void 0 : i3.checkAndGetSessionAndWindowId(true);
      if (R(e2)) ks.error("Could not read session ID. Dropping metrics!");
      else {
        this.M = this.M || {
          url: void 0,
          metrics: [],
          firstMetricTimestamp: void 0
        };
        var r2 = this.Gi();
        if (!R(r2)) if (O(null == t3 ? void 0 : t3.name) || O(null == t3 ? void 0 : t3.value)) ks.error("Invalid metric received", t3);
        else if (this.Ji && t3.value >= this.Ji) ks.error("Ignoring metric with value >= " + this.Ji, t3);
        else this.M.url !== r2 && (this.Bi(), this.Hi = setTimeout(this.Bi, this.flushToCaptureTimeoutMs)), R(this.M.url) && (this.M.url = r2), this.M.firstMetricTimestamp = R(this.M.firstMetricTimestamp) ? Date.now() : this.M.firstMetricTimestamp, t3.attribution && t3.attribution.interactionTargetElement && (t3.attribution.interactionTargetElement = void 0), this.M.metrics.push(B({}, t3, {
          $current_url: r2,
          $session_id: e2.sessionId,
          $window_id: e2.windowId,
          timestamp: Date.now()
        })), this.M.metrics.length === this.allowedMetrics.length && this.Bi();
      }
    }, this.V = () => {
      var t3, i3, e2, r2, s2 = v.__PosthogExtensions__;
      R(s2) || R(s2.postHogWebVitalsCallbacks) || ({
        onLCP: t3,
        onCLS: i3,
        onFCP: e2,
        onINP: r2
      } = s2.postHogWebVitalsCallbacks), t3 && i3 && e2 && r2 ? (this.allowedMetrics.indexOf("LCP") > -1 && t3(this.Wi.bind(this)), this.allowedMetrics.indexOf("CLS") > -1 && i3(this.Wi.bind(this)), this.allowedMetrics.indexOf("FCP") > -1 && e2(this.Wi.bind(this)), this.allowedMetrics.indexOf("INP") > -1 && r2(this.Wi.bind(this)), this.i = true) : ks.error("web vitals callbacks not loaded - not starting");
    }, this._instance = t2, this.qi = !(null == (i2 = this._instance.persistence) || !i2.props[vt]), this.startIfEnabled();
  }
  get allowedMetrics() {
    var t2, i2, e2 = I(this._instance.config.capture_performance) ? null == (t2 = this._instance.config.capture_performance) ? void 0 : t2.web_vitals_allowed_metrics : void 0;
    return R(e2) ? (null == (i2 = this._instance.persistence) ? void 0 : i2.props[ft]) || ["CLS", "FCP", "INP", "LCP"] : e2;
  }
  get flushToCaptureTimeoutMs() {
    return (I(this._instance.config.capture_performance) ? this._instance.config.capture_performance.web_vitals_delayed_flush_ms : void 0) || 5e3;
  }
  get Ji() {
    var t2 = I(this._instance.config.capture_performance) && F(this._instance.config.capture_performance.__web_vitals_max_value) ? this._instance.config.capture_performance.__web_vitals_max_value : xs;
    return 0 < t2 && t2 <= 6e4 ? xs : t2;
  }
  get isEnabled() {
    var t2 = null == a ? void 0 : a.protocol;
    if ("http:" !== t2 && "https:" !== t2) return ks.info("Web Vitals are disabled on non-http/https protocols"), false;
    var i2 = I(this._instance.config.capture_performance) ? this._instance.config.capture_performance.web_vitals : A(this._instance.config.capture_performance) ? this._instance.config.capture_performance : void 0;
    return A(i2) ? i2 : this.qi;
  }
  startIfEnabled() {
    this.isEnabled && !this.i && (ks.info("enabled, starting..."), this.G(this.V));
  }
  onRemoteConfig(t2) {
    var i2 = I(t2.capturePerformance) && !!t2.capturePerformance.web_vitals, e2 = I(t2.capturePerformance) ? t2.capturePerformance.web_vitals_allowed_metrics : void 0;
    this._instance.persistence && (this._instance.persistence.register({
      [vt]: i2
    }), this._instance.persistence.register({
      [ft]: e2
    })), this.qi = i2, this.startIfEnabled();
  }
  G(t2) {
    var i2, e2;
    null != (i2 = v.__PosthogExtensions__) && i2.postHogWebVitalsCallbacks && t2(), null == (e2 = v.__PosthogExtensions__) || null == e2.loadExternalDependency || e2.loadExternalDependency(this._instance, "web-vitals", (i3) => {
      i3 ? ks.error("failed to load script", i3) : t2();
    });
  }
  Gi() {
    var i2 = t ? t.location.href : void 0;
    return i2 || ks.error("Could not determine current URL"), i2;
  }
}
var Is = z("[Heatmaps]");
function Ps(t2) {
  return I(t2) && "clientX" in t2 && "clientY" in t2 && F(t2.clientX) && F(t2.clientY);
}
class Rs {
  constructor(t2) {
    var i2;
    this.rageclicks = new bi(), this.qi = false, this.i = false, this.Vi = null, this.instance = t2, this.qi = !(null == (i2 = this.instance.persistence) || !i2.props[ut]);
  }
  get flushIntervalMilliseconds() {
    var t2 = 5e3;
    return I(this.instance.config.capture_heatmaps) && this.instance.config.capture_heatmaps.flush_interval_milliseconds && (t2 = this.instance.config.capture_heatmaps.flush_interval_milliseconds), t2;
  }
  get isEnabled() {
    return R(this.instance.config.capture_heatmaps) ? R(this.instance.config.enable_heatmaps) ? this.qi : this.instance.config.enable_heatmaps : false !== this.instance.config.capture_heatmaps;
  }
  startIfEnabled() {
    if (this.isEnabled) {
      if (this.i) return;
      Is.info("starting..."), this.Ki(), this.Vi = setInterval(this.Yi.bind(this), this.flushIntervalMilliseconds);
    } else {
      var t2, i2;
      clearInterval(null !== (t2 = this.Vi) && void 0 !== t2 ? t2 : void 0), null == (i2 = this.Xi) || i2.stop(), this.getAndClearBuffer();
    }
  }
  onRemoteConfig(t2) {
    var i2 = !!t2.heatmaps;
    this.instance.persistence && this.instance.persistence.register({
      [ut]: i2
    }), this.qi = i2, this.startIfEnabled();
  }
  getAndClearBuffer() {
    var t2 = this.M;
    return this.M = void 0, t2;
  }
  Qi(t2) {
    this.Zi(t2.originalEvent, "deadclick");
  }
  Ki() {
    t && o && (st(t, "beforeunload", this.Yi.bind(this)), st(o, "click", (i2) => this.Zi(i2 || (null == t ? void 0 : t.event)), {
      capture: true
    }), st(o, "mousemove", (i2) => this.te(i2 || (null == t ? void 0 : t.event)), {
      capture: true
    }), this.Xi = new re(this.instance, ie, this.Qi.bind(this)), this.Xi.startIfEnabled(), this.i = true);
  }
  ie(i2, e2) {
    var r2 = this.instance.scrollManager.scrollY(), s2 = this.instance.scrollManager.scrollX(), n2 = this.instance.scrollManager.scrollElement(), o2 = (function(i3, e3, r3) {
      for (var s3 = i3; s3 && Gt(s3) && !Jt(s3, "body"); ) {
        if (s3 === r3) return false;
        if (m(e3, null == t ? void 0 : t.getComputedStyle(s3).position)) return true;
        s3 = ri(s3);
      }
      return false;
    })(ii(i2), ["fixed", "sticky"], n2);
    return {
      x: i2.clientX + (o2 ? 0 : s2),
      y: i2.clientY + (o2 ? 0 : r2),
      target_fixed: o2,
      type: e2
    };
  }
  Zi(t2, i2) {
    var e2;
    if (void 0 === i2 && (i2 = "click"), !Wt(t2.target) && Ps(t2)) {
      var r2 = this.ie(t2, i2);
      null != (e2 = this.rageclicks) && e2.isRageClick(t2.clientX, t2.clientY, (/* @__PURE__ */ new Date()).getTime()) && this.ee(B({}, r2, {
        type: "rageclick"
      })), this.ee(r2);
    }
  }
  te(t2) {
    !Wt(t2.target) && Ps(t2) && (clearTimeout(this.re), this.re = setTimeout(() => {
      this.ee(this.ie(t2, "mousemove"));
    }, 500));
  }
  ee(i2) {
    if (t) {
      var e2 = t.location.href;
      this.M = this.M || {}, this.M[e2] || (this.M[e2] = []), this.M[e2].push(i2);
    }
  }
  Yi() {
    this.M && !P(this.M) && this.instance.capture("$$heatmap", {
      $heatmap_data: this.getAndClearBuffer()
    });
  }
}
class Ts {
  constructor(t2) {
    this._instance = t2;
  }
  doPageView(i2, e2) {
    var r2, s2 = this.se(i2, e2);
    return this.ne = {
      pathname: null !== (r2 = null == t ? void 0 : t.location.pathname) && void 0 !== r2 ? r2 : "",
      pageViewId: e2,
      timestamp: i2
    }, this._instance.scrollManager.resetContext(), s2;
  }
  doPageLeave(t2) {
    var i2;
    return this.se(t2, null == (i2 = this.ne) ? void 0 : i2.pageViewId);
  }
  doEvent() {
    var t2;
    return {
      $pageview_id: null == (t2 = this.ne) ? void 0 : t2.pageViewId
    };
  }
  se(t2, i2) {
    var e2 = this.ne;
    if (!e2) return {
      $pageview_id: i2
    };
    var r2 = {
      $pageview_id: i2,
      $prev_pageview_id: e2.pageViewId
    }, s2 = this._instance.scrollManager.getContext();
    if (s2 && !this._instance.config.disable_scroll_properties) {
      var {
        maxScrollHeight: n2,
        lastScrollY: o2,
        maxScrollY: a2,
        maxContentHeight: l2,
        lastContentY: u2,
        maxContentY: h2
      } = s2;
      if (!(R(n2) || R(o2) || R(a2) || R(l2) || R(u2) || R(h2))) {
        n2 = Math.ceil(n2), o2 = Math.ceil(o2), a2 = Math.ceil(a2), l2 = Math.ceil(l2), u2 = Math.ceil(u2), h2 = Math.ceil(h2);
        var d2 = n2 <= 1 ? 1 : Xe(o2 / n2, 0, 1), v2 = n2 <= 1 ? 1 : Xe(a2 / n2, 0, 1), c2 = l2 <= 1 ? 1 : Xe(u2 / l2, 0, 1), f2 = l2 <= 1 ? 1 : Xe(h2 / l2, 0, 1);
        r2 = V(r2, {
          $prev_pageview_last_scroll: o2,
          $prev_pageview_last_scroll_percentage: d2,
          $prev_pageview_max_scroll: a2,
          $prev_pageview_max_scroll_percentage: v2,
          $prev_pageview_last_content: u2,
          $prev_pageview_last_content_percentage: c2,
          $prev_pageview_max_content: h2,
          $prev_pageview_max_content_percentage: f2
        });
      }
    }
    return e2.pathname && (r2.$prev_pageview_pathname = e2.pathname), e2.timestamp && (r2.$prev_pageview_duration = (t2.getTime() - e2.timestamp.getTime()) / 1e3), r2;
  }
}
var Ms = function(t2) {
  var i2, e2, r2, s2, n2 = "";
  for (i2 = e2 = 0, r2 = (t2 = (t2 + "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")).length, s2 = 0; s2 < r2; s2++) {
    var o2 = t2.charCodeAt(s2), a2 = null;
    o2 < 128 ? e2++ : a2 = o2 > 127 && o2 < 2048 ? String.fromCharCode(o2 >> 6 | 192, 63 & o2 | 128) : String.fromCharCode(o2 >> 12 | 224, o2 >> 6 & 63 | 128, 63 & o2 | 128), C(a2) || (e2 > i2 && (n2 += t2.substring(i2, e2)), n2 += a2, i2 = e2 = s2 + 1);
  }
  return e2 > i2 && (n2 += t2.substring(i2, t2.length)), n2;
}, Cs = !!u || !!l, Os = "text/plain", Fs = (t2, i2) => {
  var [e2, r2] = t2.split("?"), s2 = B({}, i2);
  null == r2 || r2.split("&").forEach((t3) => {
    var [i3] = t3.split("=");
    delete s2[i3];
  });
  var n2 = Si(s2);
  return e2 + "?" + (n2 = n2 ? (r2 ? r2 + "&" : "") + n2 : r2);
}, As = (t2, i2) => JSON.stringify(t2, (t3, i3) => "bigint" == typeof i3 ? i3.toString() : i3, i2), Ds = (t2) => {
  var {
    data: i2,
    compression: e2
  } = t2;
  if (i2) {
    if (e2 === g.GZipJS) {
      var r2 = Ar(Dr(As(i2)), {
        mtime: 0
      }), s2 = new Blob([r2], {
        type: Os
      });
      return {
        contentType: Os,
        body: s2,
        estimatedSize: s2.size
      };
    }
    if (e2 === g.Base64) {
      var n2 = (function(t3) {
        var i3, e3, r3, s3, n3, o3 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=", a3 = 0, l2 = 0, u2 = "", h2 = [];
        if (!t3) return t3;
        t3 = Ms(t3);
        do {
          i3 = (n3 = t3.charCodeAt(a3++) << 16 | t3.charCodeAt(a3++) << 8 | t3.charCodeAt(a3++)) >> 18 & 63, e3 = n3 >> 12 & 63, r3 = n3 >> 6 & 63, s3 = 63 & n3, h2[l2++] = o3.charAt(i3) + o3.charAt(e3) + o3.charAt(r3) + o3.charAt(s3);
        } while (a3 < t3.length);
        switch (u2 = h2.join(""), t3.length % 3) {
          case 1:
            u2 = u2.slice(0, -2) + "==";
            break;
          case 2:
            u2 = u2.slice(0, -1) + "=";
        }
        return u2;
      })(As(i2)), o2 = ((t3) => "data=" + encodeURIComponent("string" == typeof t3 ? t3 : As(t3)))(n2);
      return {
        contentType: "application/x-www-form-urlencoded",
        body: o2,
        estimatedSize: new Blob([o2]).size
      };
    }
    var a2 = As(i2);
    return {
      contentType: "application/json",
      body: a2,
      estimatedSize: new Blob([a2]).size
    };
  }
}, Ls = [];
l && Ls.push({
  transport: "fetch",
  method: (t2) => {
    var i2, e2, {
      contentType: r2,
      body: s2,
      estimatedSize: n2
    } = null !== (i2 = Ds(t2)) && void 0 !== i2 ? i2 : {}, o2 = new Headers();
    J(t2.headers, function(t3, i3) {
      o2.append(i3, t3);
    }), r2 && o2.append("Content-Type", r2);
    var a2 = t2.url, u2 = null;
    if (h) {
      var d2 = new h();
      u2 = {
        signal: d2.signal,
        timeout: setTimeout(() => d2.abort(), t2.timeout)
      };
    }
    l(a2, B({
      method: (null == t2 ? void 0 : t2.method) || "GET",
      headers: o2,
      keepalive: "POST" === t2.method && (n2 || 0) < 52428.8,
      body: s2,
      signal: null == (e2 = u2) ? void 0 : e2.signal
    }, t2.fetchOptions)).then((i3) => i3.text().then((e3) => {
      var r3 = {
        statusCode: i3.status,
        text: e3
      };
      if (200 === i3.status) try {
        r3.json = JSON.parse(e3);
      } catch (t3) {
        j.error(t3);
      }
      null == t2.callback || t2.callback(r3);
    })).catch((i3) => {
      j.error(i3), null == t2.callback || t2.callback({
        statusCode: 0,
        text: i3
      });
    }).finally(() => u2 ? clearTimeout(u2.timeout) : null);
  }
}), u && Ls.push({
  transport: "XHR",
  method: (t2) => {
    var i2, e2 = new u();
    e2.open(t2.method || "GET", t2.url, true);
    var {
      contentType: r2,
      body: s2
    } = null !== (i2 = Ds(t2)) && void 0 !== i2 ? i2 : {};
    J(t2.headers, function(t3, i3) {
      e2.setRequestHeader(i3, t3);
    }), r2 && e2.setRequestHeader("Content-Type", r2), t2.timeout && (e2.timeout = t2.timeout), e2.withCredentials = true, e2.onreadystatechange = () => {
      if (4 === e2.readyState) {
        var i3 = {
          statusCode: e2.status,
          text: e2.responseText
        };
        if (200 === e2.status) try {
          i3.json = JSON.parse(e2.responseText);
        } catch (t3) {
        }
        null == t2.callback || t2.callback(i3);
      }
    }, e2.send(s2);
  }
}), null != n && n.sendBeacon && Ls.push({
  transport: "sendBeacon",
  method: (t2) => {
    var i2 = Fs(t2.url, {
      beacon: "1"
    });
    try {
      var e2, {
        contentType: r2,
        body: s2
      } = null !== (e2 = Ds(t2)) && void 0 !== e2 ? e2 : {}, o2 = "string" == typeof s2 ? new Blob([s2], {
        type: r2
      }) : s2;
      n.sendBeacon(i2, o2);
    } catch (t3) {
    }
  }
});
var Ns = function(t2, i2) {
  if (!(function(t3) {
    try {
      new RegExp(t3);
    } catch (t4) {
      return false;
    }
    return true;
  })(i2)) return false;
  try {
    return new RegExp(i2).test(t2);
  } catch (t3) {
    return false;
  }
};
function js(t2, i2, e2) {
  return As({
    distinct_id: t2,
    userPropertiesToSet: i2,
    userPropertiesToSetOnce: e2
  });
}
var zs = {
  exact: (t2, i2) => i2.some((i3) => t2.some((t3) => i3 === t3)),
  is_not: (t2, i2) => i2.every((i3) => t2.every((t3) => i3 !== t3)),
  regex: (t2, i2) => i2.some((i3) => t2.some((t3) => Ns(i3, t3))),
  not_regex: (t2, i2) => i2.every((i3) => t2.every((t3) => !Ns(i3, t3))),
  icontains: (t2, i2) => i2.map(Us).some((i3) => t2.map(Us).some((t3) => i3.includes(t3))),
  not_icontains: (t2, i2) => i2.map(Us).every((i3) => t2.map(Us).every((t3) => !i3.includes(t3)))
}, Us = (t2) => t2.toLowerCase(), qs = z("[Error tracking]");
class Bs {
  constructor(t2) {
    var i2, e2;
    this.oe = [], this._instance = t2, this.oe = null !== (i2 = null == (e2 = this._instance.persistence) ? void 0 : e2.get_property(dt)) && void 0 !== i2 ? i2 : [];
  }
  onRemoteConfig(t2) {
    var i2, e2, r2 = null !== (i2 = null == (e2 = t2.errorTracking) ? void 0 : e2.suppressionRules) && void 0 !== i2 ? i2 : [];
    this.oe = r2, this._instance.persistence && this._instance.persistence.register({
      [dt]: this.oe
    });
  }
  sendExceptionEvent(t2) {
    this.ae(t2) ? qs.info("Skipping exception capture because a suppression rule matched") : this._instance.capture("$exception", t2, {
      _noTruncate: true,
      _batchKey: "exceptionEvent"
    });
  }
  ae(t2) {
    var i2 = t2.$exception_list;
    if (!i2 || !x(i2) || 0 === i2.length) return false;
    var e2 = i2.reduce((t3, i3) => {
      var {
        type: e3,
        value: r2
      } = i3;
      return T(e3) && e3.length > 0 && t3.$exception_types.push(e3), T(r2) && r2.length > 0 && t3.$exception_messages.push(r2), t3;
    }, {
      $exception_types: [],
      $exception_messages: []
    });
    return this.oe.some((t3) => {
      var i3 = t3.values.map((t4) => {
        var i4 = zs[t4.operator], r2 = x(t4.value) ? t4.value : [t4.value], s2 = e2[t4.key];
        return r2.length > 0 && i4(r2, s2);
      });
      return "OR" === t3.type ? i3.some(Boolean) : i3.every(Boolean);
    });
  }
}
var Hs = "Mobile", Ws = "iOS", Gs = "Android", Js = "Tablet", Vs = Gs + " " + Js, Ks = "iPad", Ys = "Apple", Xs = Ys + " Watch", Qs = "Safari", Zs = "BlackBerry", tn = "Samsung", en = tn + "Browser", rn = tn + " Internet", sn = "Chrome", nn = sn + " OS", on = sn + " " + Ws, an = "Internet Explorer", ln = an + " " + Hs, un = "Opera", hn = un + " Mini", dn = "Edge", vn = "Microsoft " + dn, cn = "Firefox", fn = cn + " " + Ws, pn = "Nintendo", gn = "PlayStation", _n = "Xbox", mn = Gs + " " + Hs, bn = Hs + " " + Qs, wn = "Windows", yn = wn + " Phone", Sn = "Nokia", $n = "Ouya", kn = "Generic", xn = kn + " " + Hs.toLowerCase(), En = kn + " " + Js.toLowerCase(), In = "Konqueror", Pn = "(\\d+(\\.\\d+)?)", Rn = new RegExp("Version/" + Pn), Tn = new RegExp(_n, "i"), Mn = new RegExp(gn + " \\w+", "i"), Cn = new RegExp(pn + " \\w+", "i"), On = new RegExp(Zs + "|PlayBook|BB10", "i"), Fn = {
  "NT3.51": "NT 3.11",
  "NT4.0": "NT 4.0",
  "5.0": "2000",
  5.1: "XP",
  5.2: "XP",
  "6.0": "Vista",
  6.1: "7",
  6.2: "8",
  6.3: "8.1",
  6.4: "10",
  "10.0": "10"
};
var An = (t2, i2) => i2 && m(i2, Ys) || (function(t3) {
  return m(t3, Qs) && !m(t3, sn) && !m(t3, Gs);
})(t2), Dn = function(t2, i2) {
  return i2 = i2 || "", m(t2, " OPR/") && m(t2, "Mini") ? hn : m(t2, " OPR/") ? un : On.test(t2) ? Zs : m(t2, "IE" + Hs) || m(t2, "WPDesktop") ? ln : m(t2, en) ? rn : m(t2, dn) || m(t2, "Edg/") ? vn : m(t2, "FBIOS") ? "Facebook " + Hs : m(t2, "UCWEB") || m(t2, "UCBrowser") ? "UC Browser" : m(t2, "CriOS") ? on : m(t2, "CrMo") || m(t2, sn) ? sn : m(t2, Gs) && m(t2, Qs) ? mn : m(t2, "FxiOS") ? fn : m(t2.toLowerCase(), In.toLowerCase()) ? In : An(t2, i2) ? m(t2, Hs) ? bn : Qs : m(t2, cn) ? cn : m(t2, "MSIE") || m(t2, "Trident/") ? an : m(t2, "Gecko") ? cn : "";
}, Ln = {
  [ln]: [new RegExp("rv:" + Pn)],
  [vn]: [new RegExp(dn + "?\\/" + Pn)],
  [sn]: [new RegExp("(" + sn + "|CrMo)\\/" + Pn)],
  [on]: [new RegExp("CriOS\\/" + Pn)],
  "UC Browser": [new RegExp("(UCBrowser|UCWEB)\\/" + Pn)],
  [Qs]: [Rn],
  [bn]: [Rn],
  [un]: [new RegExp("(Opera|OPR)\\/" + Pn)],
  [cn]: [new RegExp(cn + "\\/" + Pn)],
  [fn]: [new RegExp("FxiOS\\/" + Pn)],
  [In]: [new RegExp("Konqueror[:/]?" + Pn, "i")],
  [Zs]: [new RegExp(Zs + " " + Pn), Rn],
  [mn]: [new RegExp("android\\s" + Pn, "i")],
  [rn]: [new RegExp(en + "\\/" + Pn)],
  [an]: [new RegExp("(rv:|MSIE )" + Pn)],
  Mozilla: [new RegExp("rv:" + Pn)]
}, Nn = function(t2, i2) {
  var e2 = Dn(t2, i2), r2 = Ln[e2];
  if (R(r2)) return null;
  for (var s2 = 0; s2 < r2.length; s2++) {
    var n2 = r2[s2], o2 = t2.match(n2);
    if (o2) return parseFloat(o2[o2.length - 2]);
  }
  return null;
}, jn = [[new RegExp(_n + "; " + _n + " (.*?)[);]", "i"), (t2) => [_n, t2 && t2[1] || ""]], [new RegExp(pn, "i"), [pn, ""]], [new RegExp(gn, "i"), [gn, ""]], [On, [Zs, ""]], [new RegExp(wn, "i"), (t2, i2) => {
  if (/Phone/.test(i2) || /WPDesktop/.test(i2)) return [yn, ""];
  if (new RegExp(Hs).test(i2) && !/IEMobile\b/.test(i2)) return [wn + " " + Hs, ""];
  var e2 = /Windows NT ([0-9.]+)/i.exec(i2);
  if (e2 && e2[1]) {
    var r2 = e2[1], s2 = Fn[r2] || "";
    return /arm/i.test(i2) && (s2 = "RT"), [wn, s2];
  }
  return [wn, ""];
}], [/((iPhone|iPad|iPod).*?OS (\d+)_(\d+)_?(\d+)?|iPhone)/, (t2) => {
  if (t2 && t2[3]) {
    var i2 = [t2[3], t2[4], t2[5] || "0"];
    return [Ws, i2.join(".")];
  }
  return [Ws, ""];
}], [/(watch.*\/(\d+\.\d+\.\d+)|watch os,(\d+\.\d+),)/i, (t2) => {
  var i2 = "";
  return t2 && t2.length >= 3 && (i2 = R(t2[2]) ? t2[3] : t2[2]), ["watchOS", i2];
}], [new RegExp("(" + Gs + " (\\d+)\\.(\\d+)\\.?(\\d+)?|" + Gs + ")", "i"), (t2) => {
  if (t2 && t2[2]) {
    var i2 = [t2[2], t2[3], t2[4] || "0"];
    return [Gs, i2.join(".")];
  }
  return [Gs, ""];
}], [/Mac OS X (\d+)[_.](\d+)[_.]?(\d+)?/i, (t2) => {
  var i2 = ["Mac OS X", ""];
  if (t2 && t2[1]) {
    var e2 = [t2[1], t2[2], t2[3] || "0"];
    i2[1] = e2.join(".");
  }
  return i2;
}], [/Mac/i, ["Mac OS X", ""]], [/CrOS/, [nn, ""]], [/Linux|debian/i, ["Linux", ""]]], zn = function(t2) {
  return Cn.test(t2) ? pn : Mn.test(t2) ? gn : Tn.test(t2) ? _n : new RegExp($n, "i").test(t2) ? $n : new RegExp("(" + yn + "|WPDesktop)", "i").test(t2) ? yn : /iPad/.test(t2) ? Ks : /iPod/.test(t2) ? "iPod Touch" : /iPhone/.test(t2) ? "iPhone" : /(watch)(?: ?os[,/]|\d,\d\/)[\d.]+/i.test(t2) ? Xs : On.test(t2) ? Zs : /(kobo)\s(ereader|touch)/i.test(t2) ? "Kobo" : new RegExp(Sn, "i").test(t2) ? Sn : /(kf[a-z]{2}wi|aeo[c-r]{2})( bui|\))/i.test(t2) || /(kf[a-z]+)( bui|\)).+silk\//i.test(t2) ? "Kindle Fire" : /(Android|ZTE)/i.test(t2) ? !new RegExp(Hs).test(t2) || /(9138B|TB782B|Nexus [97]|pixel c|HUAWEISHT|BTV|noble nook|smart ultra 6)/i.test(t2) ? /pixel[\daxl ]{1,6}/i.test(t2) && !/pixel c/i.test(t2) || /(huaweimed-al00|tah-|APA|SM-G92|i980|zte|U304AA)/i.test(t2) || /lmy47v/i.test(t2) && !/QTAQZ3/i.test(t2) ? Gs : Vs : Gs : new RegExp("(pda|" + Hs + ")", "i").test(t2) ? xn : new RegExp(Js, "i").test(t2) && !new RegExp(Js + " pc", "i").test(t2) ? En : "";
}, Un = "https?://(.*)", qn = ["gclid", "gclsrc", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "twclid", "li_fat_id", "igshid", "ttclid", "rdt_cid", "epik", "qclid", "sccid", "irclid", "_kx"], Bn = K(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gad_source", "mc_cid"], qn), Hn = "<masked>";
function Wn(t2, i2, e2) {
  if (!o) return {};
  var r2 = i2 ? K([], qn, e2 || []) : [];
  return Gn(ki(o.URL, r2, Hn), t2);
}
function Gn(t2, i2) {
  var e2 = Bn.concat(i2 || []), r2 = {};
  return J(e2, function(i3) {
    var e3 = $i(t2, i3);
    r2[i3] = e3 || null;
  }), r2;
}
function Jn(t2) {
  var i2 = (function(t3) {
    return t3 ? 0 === t3.search(Un + "google.([^/?]*)") ? "google" : 0 === t3.search(Un + "bing.com") ? "bing" : 0 === t3.search(Un + "yahoo.com") ? "yahoo" : 0 === t3.search(Un + "duckduckgo.com") ? "duckduckgo" : null : null;
  })(t2), e2 = "yahoo" != i2 ? "q" : "p", r2 = {};
  if (!C(i2)) {
    r2.$search_engine = i2;
    var s2 = o ? $i(o.referrer, e2) : "";
    s2.length && (r2.ph_keyword = s2);
  }
  return r2;
}
function Vn() {
  return navigator.language || navigator.userLanguage;
}
function Kn() {
  return (null == o ? void 0 : o.referrer) || "$direct";
}
function Yn(t2, i2) {
  var e2 = t2 ? K([], qn, i2 || []) : [], r2 = null == a ? void 0 : a.href.substring(0, 1e3);
  return {
    r: Kn().substring(0, 1e3),
    u: r2 ? ki(r2, e2, Hn) : void 0
  };
}
function Xn(t2) {
  var i2, {
    r: e2,
    u: r2
  } = t2, s2 = {
    $referrer: e2,
    $referring_domain: null == e2 ? void 0 : "$direct" == e2 ? "$direct" : null == (i2 = yi(e2)) ? void 0 : i2.host
  };
  if (r2) {
    s2.$current_url = r2;
    var n2 = yi(r2);
    s2.$host = null == n2 ? void 0 : n2.host, s2.$pathname = null == n2 ? void 0 : n2.pathname;
    var o2 = Gn(r2);
    V(s2, o2);
  }
  if (e2) {
    var a2 = Jn(e2);
    V(s2, a2);
  }
  return s2;
}
function Qn() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (t2) {
    return;
  }
}
function Zn() {
  try {
    return (/* @__PURE__ */ new Date()).getTimezoneOffset();
  } catch (t2) {
    return;
  }
}
function to(i2, e2) {
  if (!d) return {};
  var r2, s2, n2, o2 = i2 ? K([], qn, e2 || []) : [], [l2, u2] = (function(t2) {
    for (var i3 = 0; i3 < jn.length; i3++) {
      var [e3, r3] = jn[i3], s3 = e3.exec(t2), n3 = s3 && (E(r3) ? r3(s3, t2) : r3);
      if (n3) return n3;
    }
    return ["", ""];
  })(d);
  return V(Z({
    $os: l2,
    $os_version: u2,
    $browser: Dn(d, navigator.vendor),
    $device: zn(d),
    $device_type: (s2 = d, n2 = zn(s2), n2 === Ks || n2 === Vs || "Kobo" === n2 || "Kindle Fire" === n2 || n2 === En ? Js : n2 === pn || n2 === _n || n2 === gn || n2 === $n ? "Console" : n2 === Xs ? "Wearable" : n2 ? Hs : "Desktop"),
    $timezone: Qn(),
    $timezone_offset: Zn()
  }), {
    $current_url: ki(null == a ? void 0 : a.href, o2, Hn),
    $host: null == a ? void 0 : a.host,
    $pathname: null == a ? void 0 : a.pathname,
    $raw_user_agent: d.length > 1e3 ? d.substring(0, 997) + "..." : d,
    $browser_version: Nn(d, navigator.vendor),
    $browser_language: Vn(),
    $browser_language_prefix: (r2 = Vn(), "string" == typeof r2 ? r2.split("-")[0] : void 0),
    $screen_height: null == t ? void 0 : t.screen.height,
    $screen_width: null == t ? void 0 : t.screen.width,
    $viewport_height: null == t ? void 0 : t.innerHeight,
    $viewport_width: null == t ? void 0 : t.innerWidth,
    $lib: "web",
    $lib_version: c.LIB_VERSION,
    $insert_id: Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
    $time: Date.now() / 1e3
  });
}
var io = z("[FeatureFlags]"), eo = "$active_feature_flags", ro = "$override_feature_flags", so = "$feature_flag_payloads", no = "$override_feature_flag_payloads", oo = "$feature_flag_request_id", ao = (t2) => {
  var i2 = {};
  for (var [e2, r2] of Y(t2 || {})) r2 && (i2[e2] = r2);
  return i2;
}, lo = (t2) => {
  var i2 = t2.flags;
  return i2 ? (t2.featureFlags = Object.fromEntries(Object.keys(i2).map((t3) => {
    var e2;
    return [t3, null !== (e2 = i2[t3].variant) && void 0 !== e2 ? e2 : i2[t3].enabled];
  })), t2.featureFlagPayloads = Object.fromEntries(Object.keys(i2).filter((t3) => i2[t3].enabled).filter((t3) => {
    var e2;
    return null == (e2 = i2[t3].metadata) ? void 0 : e2.payload;
  }).map((t3) => {
    var e2;
    return [t3, null == (e2 = i2[t3].metadata) ? void 0 : e2.payload];
  }))) : io.warn("Using an older version of the feature flags endpoint. Please upgrade your PostHog server to the latest version"), t2;
}, uo = (function(t2) {
  return t2.FeatureFlags = "feature_flags", t2.Recordings = "recordings", t2;
})({});
class ho {
  constructor(t2) {
    this.le = false, this.ue = false, this.he = false, this.de = false, this.ve = false, this.ce = false, this.fe = false, this._instance = t2, this.featureFlagEventHandlers = [];
  }
  decide() {
    if (this._instance.config.__preview_remote_config) this.ce = true;
    else {
      var t2 = !this.pe && (this._instance.config.advanced_disable_feature_flags || this._instance.config.advanced_disable_feature_flags_on_first_load);
      this.ge({
        disableFlags: t2
      });
    }
  }
  get hasLoadedFlags() {
    return this.ue;
  }
  getFlags() {
    return Object.keys(this.getFlagVariants());
  }
  getFlagsWithDetails() {
    var t2 = this._instance.get_property(Rt), i2 = this._instance.get_property(ro), e2 = this._instance.get_property(no);
    if (!e2 && !i2) return t2 || {};
    var r2 = V({}, t2 || {}), s2 = [.../* @__PURE__ */ new Set([...Object.keys(e2 || {}), ...Object.keys(i2 || {})])];
    for (var n2 of s2) {
      var o2, a2, l2 = r2[n2], u2 = null == i2 ? void 0 : i2[n2], h2 = R(u2) ? null !== (o2 = null == l2 ? void 0 : l2.enabled) && void 0 !== o2 && o2 : !!u2, d2 = R(u2) ? l2.variant : "string" == typeof u2 ? u2 : void 0, v2 = null == e2 ? void 0 : e2[n2], c2 = B({}, l2, {
        enabled: h2,
        variant: h2 ? null != d2 ? d2 : null == l2 ? void 0 : l2.variant : void 0
      });
      if (h2 !== (null == l2 ? void 0 : l2.enabled) && (c2.original_enabled = null == l2 ? void 0 : l2.enabled), d2 !== (null == l2 ? void 0 : l2.variant) && (c2.original_variant = null == l2 ? void 0 : l2.variant), v2) c2.metadata = B({}, null == l2 ? void 0 : l2.metadata, {
        payload: v2,
        original_payload: null == l2 || null == (a2 = l2.metadata) ? void 0 : a2.payload
      });
      r2[n2] = c2;
    }
    return this.le || (io.warn(" Overriding feature flag details!", {
      flagDetails: t2,
      overriddenPayloads: e2,
      finalDetails: r2
    }), this.le = true), r2;
  }
  getFlagVariants() {
    var t2 = this._instance.get_property(It), i2 = this._instance.get_property(ro);
    if (!i2) return t2 || {};
    for (var e2 = V({}, t2), r2 = Object.keys(i2), s2 = 0; s2 < r2.length; s2++) e2[r2[s2]] = i2[r2[s2]];
    return this.le || (io.warn(" Overriding feature flags!", {
      enabledFlags: t2,
      overriddenFlags: i2,
      finalFlags: e2
    }), this.le = true), e2;
  }
  getFlagPayloads() {
    var t2 = this._instance.get_property(so), i2 = this._instance.get_property(no);
    if (!i2) return t2 || {};
    for (var e2 = V({}, t2 || {}), r2 = Object.keys(i2), s2 = 0; s2 < r2.length; s2++) e2[r2[s2]] = i2[r2[s2]];
    return this.le || (io.warn(" Overriding feature flag payloads!", {
      flagPayloads: t2,
      overriddenPayloads: i2,
      finalPayloads: e2
    }), this.le = true), e2;
  }
  reloadFeatureFlags() {
    this.de || this._instance.config.advanced_disable_feature_flags || this.pe || (this.pe = setTimeout(() => {
      this.ge();
    }, 5));
  }
  _e() {
    clearTimeout(this.pe), this.pe = void 0;
  }
  ensureFlagsLoaded() {
    this.ue || this.he || this.pe || this.reloadFeatureFlags();
  }
  setAnonymousDistinctId(t2) {
    this.$anon_distinct_id = t2;
  }
  setReloadingPaused(t2) {
    this.de = t2;
  }
  ge(t2) {
    var i2;
    if (this._e(), !this._instance.config.advanced_disable_decide) if (this.he) this.ve = true;
    else {
      var e2 = {
        token: this._instance.config.token,
        distinct_id: this._instance.get_distinct_id(),
        groups: this._instance.getGroups(),
        $anon_distinct_id: this.$anon_distinct_id,
        person_properties: B({}, (null == (i2 = this._instance.persistence) ? void 0 : i2.get_initial_props()) || {}, this._instance.get_property(Tt) || {}),
        group_properties: this._instance.get_property(Mt)
      };
      (null != t2 && t2.disableFlags || this._instance.config.advanced_disable_feature_flags) && (e2.disable_flags = true);
      var r2 = this._instance.config.__preview_flags_v2 && this._instance.config.__preview_remote_config;
      r2 && (e2.timezone = Qn()), this.he = true, this._instance.me({
        method: "POST",
        url: this._instance.requestRouter.endpointFor("api", r2 ? "/flags/?v=2" : "/decide/?v=4"),
        data: e2,
        compression: this._instance.config.disable_compression ? void 0 : g.Base64,
        timeout: this._instance.config.feature_flag_request_timeout_ms,
        callback: (t3) => {
          var i3, r3, s2 = true;
          (200 === t3.statusCode && (this.ve || (this.$anon_distinct_id = void 0), s2 = false), this.he = false, this.ce) || (this.ce = true, this._instance.be(null !== (r3 = t3.json) && void 0 !== r3 ? r3 : {}));
          if (!e2.disable_flags || this.ve) if (this.fe = !s2, t3.json && null != (i3 = t3.json.quotaLimited) && i3.includes(uo.FeatureFlags)) io.warn("You have hit your feature flags quota limit, and will not be able to load feature flags until the quota is reset.  Please visit https://posthog.com/docs/billing/limits-alerts to learn more.");
          else {
            var n2;
            if (!e2.disable_flags) this.receivedFeatureFlags(null !== (n2 = t3.json) && void 0 !== n2 ? n2 : {}, s2);
            this.ve && (this.ve = false, this.ge());
          }
        }
      });
    }
  }
  getFeatureFlag(t2, i2) {
    if (void 0 === i2 && (i2 = {}), this.ue || this.getFlags() && this.getFlags().length > 0) {
      var e2 = this.getFlagVariants()[t2], r2 = "" + e2, s2 = this._instance.get_property(oo) || void 0, n2 = this._instance.get_property(Ft) || {};
      if ((i2.send_event || !("send_event" in i2)) && (!(t2 in n2) || !n2[t2].includes(r2))) {
        var o2, a2, l2, u2, h2, d2, v2, c2, f2;
        x(n2[t2]) ? n2[t2].push(r2) : n2[t2] = [r2], null == (o2 = this._instance.persistence) || o2.register({
          [Ft]: n2
        });
        var p2 = this.getFeatureFlagDetails(t2), g2 = {
          $feature_flag: t2,
          $feature_flag_response: e2,
          $feature_flag_payload: this.getFeatureFlagPayload(t2) || null,
          $feature_flag_request_id: s2,
          $feature_flag_bootstrapped_response: (null == (a2 = this._instance.config.bootstrap) || null == (a2 = a2.featureFlags) ? void 0 : a2[t2]) || null,
          $feature_flag_bootstrapped_payload: (null == (l2 = this._instance.config.bootstrap) || null == (l2 = l2.featureFlagPayloads) ? void 0 : l2[t2]) || null,
          $used_bootstrap_value: !this.fe
        };
        R(null == p2 || null == (u2 = p2.metadata) ? void 0 : u2.version) || (g2.$feature_flag_version = p2.metadata.version);
        var _2, m2 = null !== (h2 = null == p2 || null == (d2 = p2.reason) ? void 0 : d2.description) && void 0 !== h2 ? h2 : null == p2 || null == (v2 = p2.reason) ? void 0 : v2.code;
        if (m2 && (g2.$feature_flag_reason = m2), null != p2 && null != (c2 = p2.metadata) && c2.id && (g2.$feature_flag_id = p2.metadata.id), R(null == p2 ? void 0 : p2.original_variant) && R(null == p2 ? void 0 : p2.original_enabled) || (g2.$feature_flag_original_response = R(p2.original_variant) ? p2.original_enabled : p2.original_variant), null != p2 && null != (f2 = p2.metadata) && f2.original_payload) g2.$feature_flag_original_payload = null == p2 || null == (_2 = p2.metadata) ? void 0 : _2.original_payload;
        this._instance.capture("$feature_flag_called", g2);
      }
      return e2;
    }
    io.warn('getFeatureFlag for key "' + t2 + `" failed. Feature flags didn't load in time.`);
  }
  getFeatureFlagDetails(t2) {
    return this.getFlagsWithDetails()[t2];
  }
  getFeatureFlagPayload(t2) {
    return this.getFlagPayloads()[t2];
  }
  getRemoteConfigPayload(t2, i2) {
    var e2 = this._instance.config.token;
    this._instance.me({
      method: "POST",
      url: this._instance.requestRouter.endpointFor("api", "/decide/?v=4"),
      data: {
        distinct_id: this._instance.get_distinct_id(),
        token: e2
      },
      compression: this._instance.config.disable_compression ? void 0 : g.Base64,
      timeout: this._instance.config.feature_flag_request_timeout_ms,
      callback: (e3) => {
        var r2, s2 = null == (r2 = e3.json) ? void 0 : r2.featureFlagPayloads;
        i2((null == s2 ? void 0 : s2[t2]) || void 0);
      }
    });
  }
  isFeatureEnabled(t2, i2) {
    if (void 0 === i2 && (i2 = {}), this.ue || this.getFlags() && this.getFlags().length > 0) return !!this.getFeatureFlag(t2, i2);
    io.warn('isFeatureEnabled for key "' + t2 + `" failed. Feature flags didn't load in time.`);
  }
  addFeatureFlagsHandler(t2) {
    this.featureFlagEventHandlers.push(t2);
  }
  removeFeatureFlagsHandler(t2) {
    this.featureFlagEventHandlers = this.featureFlagEventHandlers.filter((i2) => i2 !== t2);
  }
  receivedFeatureFlags(t2, i2) {
    if (this._instance.persistence) {
      this.ue = true;
      var e2 = this.getFlagVariants(), r2 = this.getFlagPayloads(), s2 = this.getFlagsWithDetails();
      !(function(t3, i3, e3, r3, s3) {
        void 0 === e3 && (e3 = {}), void 0 === r3 && (r3 = {}), void 0 === s3 && (s3 = {});
        var n2 = lo(t3), o2 = n2.flags, a2 = n2.featureFlags, l2 = n2.featureFlagPayloads;
        if (a2) {
          var u2 = t3.requestId;
          if (x(a2)) {
            io.warn("v1 of the feature flags endpoint is deprecated. Please use the latest version.");
            var h2 = {};
            if (a2) for (var d2 = 0; d2 < a2.length; d2++) h2[a2[d2]] = true;
            i3 && i3.register({
              [eo]: a2,
              [It]: h2
            });
          } else {
            var v2 = a2, c2 = l2, f2 = o2;
            t3.errorsWhileComputingFlags && (v2 = B({}, e3, v2), c2 = B({}, r3, c2), f2 = B({}, s3, f2)), i3 && i3.register(B({
              [eo]: Object.keys(ao(v2)),
              [It]: v2 || {},
              [so]: c2 || {},
              [Rt]: f2 || {}
            }, u2 ? {
              [oo]: u2
            } : {}));
          }
        }
      })(t2, this._instance.persistence, e2, r2, s2), this.we(i2);
    }
  }
  override(t2, i2) {
    void 0 === i2 && (i2 = false), io.warn("override is deprecated. Please use overrideFeatureFlags instead."), this.overrideFeatureFlags({
      flags: t2,
      suppressWarning: i2
    });
  }
  overrideFeatureFlags(t2) {
    if (!this._instance.__loaded || !this._instance.persistence) return io.uninitializedWarning("posthog.featureFlags.overrideFeatureFlags");
    if (false === t2) return this._instance.persistence.unregister(ro), this._instance.persistence.unregister(no), void this.we();
    if (t2 && "object" == typeof t2 && ("flags" in t2 || "payloads" in t2)) {
      var i2, e2 = t2;
      if (this.le = Boolean(null !== (i2 = e2.suppressWarning) && void 0 !== i2 && i2), "flags" in e2) {
        if (false === e2.flags) this._instance.persistence.unregister(ro);
        else if (e2.flags) if (x(e2.flags)) {
          for (var r2 = {}, s2 = 0; s2 < e2.flags.length; s2++) r2[e2.flags[s2]] = true;
          this._instance.persistence.register({
            [ro]: r2
          });
        } else this._instance.persistence.register({
          [ro]: e2.flags
        });
      }
      return "payloads" in e2 && (false === e2.payloads ? this._instance.persistence.unregister(no) : e2.payloads && this._instance.persistence.register({
        [no]: e2.payloads
      })), void this.we();
    }
    this.we();
  }
  onFeatureFlags(t2) {
    if (this.addFeatureFlagsHandler(t2), this.ue) {
      var {
        flags: i2,
        flagVariants: e2
      } = this.ye();
      t2(i2, e2);
    }
    return () => this.removeFeatureFlagsHandler(t2);
  }
  updateEarlyAccessFeatureEnrollment(t2, i2) {
    var e2, r2 = (this._instance.get_property(Pt) || []).find((i3) => i3.flagKey === t2), s2 = {
      ["$feature_enrollment/" + t2]: i2
    }, n2 = {
      $feature_flag: t2,
      $feature_enrollment: i2,
      $set: s2
    };
    r2 && (n2.$early_access_feature_name = r2.name), this._instance.capture("$feature_enrollment_update", n2), this.setPersonPropertiesForFlags(s2, false);
    var o2 = B({}, this.getFlagVariants(), {
      [t2]: i2
    });
    null == (e2 = this._instance.persistence) || e2.register({
      [eo]: Object.keys(ao(o2)),
      [It]: o2
    }), this.we();
  }
  getEarlyAccessFeatures(t2, i2, e2) {
    void 0 === i2 && (i2 = false);
    var r2 = this._instance.get_property(Pt), s2 = e2 ? "&" + e2.map((t3) => "stage=" + t3).join("&") : "";
    if (r2 && !i2) return t2(r2);
    this._instance.me({
      url: this._instance.requestRouter.endpointFor("api", "/api/early_access_features/?token=" + this._instance.config.token + s2),
      method: "GET",
      callback: (i3) => {
        var e3;
        if (i3.json) {
          var r3 = i3.json.earlyAccessFeatures;
          return null == (e3 = this._instance.persistence) || e3.register({
            [Pt]: r3
          }), t2(r3);
        }
      }
    });
  }
  ye() {
    var t2 = this.getFlags(), i2 = this.getFlagVariants();
    return {
      flags: t2.filter((t3) => i2[t3]),
      flagVariants: Object.keys(i2).filter((t3) => i2[t3]).reduce((t3, e2) => (t3[e2] = i2[e2], t3), {})
    };
  }
  we(t2) {
    var {
      flags: i2,
      flagVariants: e2
    } = this.ye();
    this.featureFlagEventHandlers.forEach((r2) => r2(i2, e2, {
      errorsLoading: t2
    }));
  }
  setPersonPropertiesForFlags(t2, i2) {
    void 0 === i2 && (i2 = true);
    var e2 = this._instance.get_property(Tt) || {};
    this._instance.register({
      [Tt]: B({}, e2, t2)
    }), i2 && this._instance.reloadFeatureFlags();
  }
  resetPersonPropertiesForFlags() {
    this._instance.unregister(Tt);
  }
  setGroupPropertiesForFlags(t2, i2) {
    void 0 === i2 && (i2 = true);
    var e2 = this._instance.get_property(Mt) || {};
    0 !== Object.keys(e2).length && Object.keys(e2).forEach((i3) => {
      e2[i3] = B({}, e2[i3], t2[i3]), delete t2[i3];
    }), this._instance.register({
      [Mt]: B({}, e2, t2)
    }), i2 && this._instance.reloadFeatureFlags();
  }
  resetGroupPropertiesForFlags(t2) {
    if (t2) {
      var i2 = this._instance.get_property(Mt) || {};
      this._instance.register({
        [Mt]: B({}, i2, {
          [t2]: {}
        })
      });
    } else this._instance.unregister(Mt);
  }
}
var vo = ["cookie", "localstorage", "localstorage+cookie", "sessionstorage", "memory"];
class co {
  constructor(t2) {
    this.S = t2, this.props = {}, this.Se = false, this.$e = ((t3) => {
      var i2 = "";
      return t3.token && (i2 = t3.token.replace(/\+/g, "PL").replace(/\//g, "SL").replace(/=/g, "EQ")), t3.persistence_name ? "ph_" + t3.persistence_name : "ph_" + i2 + "_posthog";
    })(t2), this.q = this.ke(t2), this.load(), t2.debug && j.info("Persistence loaded", t2.persistence, B({}, this.props)), this.update_config(t2, t2), this.save();
  }
  ke(t2) {
    -1 === vo.indexOf(t2.persistence.toLowerCase()) && (j.critical("Unknown persistence type " + t2.persistence + "; falling back to localStorage+cookie"), t2.persistence = "localStorage+cookie");
    var i2 = t2.persistence.toLowerCase();
    return "localstorage" === i2 && Wi.O() ? Wi : "localstorage+cookie" === i2 && Ji.O() ? Ji : "sessionstorage" === i2 && Xi.O() ? Xi : "memory" === i2 ? Ki : "cookie" === i2 ? Bi : Ji.O() ? Ji : Bi;
  }
  properties() {
    var t2 = {};
    return J(this.props, function(i2, e2) {
      if (e2 === It && I(i2)) for (var r2 = Object.keys(i2), n2 = 0; n2 < r2.length; n2++) t2["$feature/" + r2[n2]] = i2[r2[n2]];
      else a2 = e2, l2 = false, (C(o2 = Ht) ? l2 : s && o2.indexOf === s ? -1 != o2.indexOf(a2) : (J(o2, function(t3) {
        if (l2 || (l2 = t3 === a2)) return W;
      }), l2)) || (t2[e2] = i2);
      var o2, a2, l2;
    }), t2;
  }
  load() {
    if (!this.xe) {
      var t2 = this.q.D(this.$e);
      t2 && (this.props = V({}, t2));
    }
  }
  save() {
    this.xe || this.q.L(this.$e, this.props, this.Ee, this.Ie, this.Pe, this.S.debug);
  }
  remove() {
    this.q.N(this.$e, false), this.q.N(this.$e, true);
  }
  clear() {
    this.remove(), this.props = {};
  }
  register_once(t2, i2, e2) {
    if (I(t2)) {
      R(i2) && (i2 = "None"), this.Ee = R(e2) ? this.Re : e2;
      var r2 = false;
      if (J(t2, (t3, e3) => {
        this.props.hasOwnProperty(e3) && this.props[e3] !== i2 || (this.props[e3] = t3, r2 = true);
      }), r2) return this.save(), true;
    }
    return false;
  }
  register(t2, i2) {
    if (I(t2)) {
      this.Ee = R(i2) ? this.Re : i2;
      var e2 = false;
      if (J(t2, (i3, r2) => {
        t2.hasOwnProperty(r2) && this.props[r2] !== i3 && (this.props[r2] = i3, e2 = true);
      }), e2) return this.save(), true;
    }
    return false;
  }
  unregister(t2) {
    t2 in this.props && (delete this.props[t2], this.save());
  }
  update_campaign_params() {
    if (!this.Se) {
      var t2 = Wn(this.S.custom_campaign_params, this.S.mask_personal_data_properties, this.S.custom_personal_data_properties);
      P(Z(t2)) || this.register(t2), this.Se = true;
    }
  }
  update_search_keyword() {
    var t2;
    this.register((t2 = null == o ? void 0 : o.referrer) ? Jn(t2) : {});
  }
  update_referrer_info() {
    var t2;
    this.register_once({
      $referrer: Kn(),
      $referring_domain: null != o && o.referrer && (null == (t2 = yi(o.referrer)) ? void 0 : t2.host) || "$direct"
    }, void 0);
  }
  set_initial_person_info() {
    this.props[Nt] || this.props[jt] || this.register_once({
      [zt]: Yn(this.S.mask_personal_data_properties, this.S.custom_personal_data_properties)
    }, void 0);
  }
  get_initial_props() {
    var t2 = {};
    J([jt, Nt], (i3) => {
      var e3 = this.props[i3];
      e3 && J(e3, function(i4, e4) {
        t2["$initial_" + w(e4)] = i4;
      });
    });
    var i2, e2, r2 = this.props[zt];
    if (r2) {
      var s2 = (i2 = Xn(r2), e2 = {}, J(i2, function(t3, i3) {
        e2["$initial_" + w(i3)] = t3;
      }), e2);
      V(t2, s2);
    }
    return t2;
  }
  safe_merge(t2) {
    return J(this.props, function(i2, e2) {
      e2 in t2 || (t2[e2] = i2);
    }), t2;
  }
  update_config(t2, i2) {
    if (this.Re = this.Ee = t2.cookie_expiration, this.set_disabled(t2.disable_persistence), this.set_cross_subdomain(t2.cross_subdomain_cookie), this.set_secure(t2.secure_cookie), t2.persistence !== i2.persistence) {
      var e2 = this.ke(t2), r2 = this.props;
      this.clear(), this.q = e2, this.props = r2, this.save();
    }
  }
  set_disabled(t2) {
    this.xe = t2, this.xe ? this.remove() : this.save();
  }
  set_cross_subdomain(t2) {
    t2 !== this.Ie && (this.Ie = t2, this.remove(), this.save());
  }
  set_secure(t2) {
    t2 !== this.Pe && (this.Pe = t2, this.remove(), this.save());
  }
  set_event_timer(t2, i2) {
    var e2 = this.props[at] || {};
    e2[t2] = i2, this.props[at] = e2, this.save();
  }
  remove_event_timer(t2) {
    var i2 = (this.props[at] || {})[t2];
    return R(i2) || (delete this.props[at][t2], this.save()), i2;
  }
  get_property(t2) {
    return this.props[t2];
  }
  set_property(t2, i2) {
    this.props[t2] = i2, this.save();
  }
}
class fo {
  constructor() {
    this.Te = {}, this.Te = {};
  }
  on(t2, i2) {
    return this.Te[t2] || (this.Te[t2] = []), this.Te[t2].push(i2), () => {
      this.Te[t2] = this.Te[t2].filter((t3) => t3 !== i2);
    };
  }
  emit(t2, i2) {
    for (var e2 of this.Te[t2] || []) e2(i2);
    for (var r2 of this.Te["*"] || []) r2(t2, i2);
  }
}
class po {
  constructor(t2) {
    this.Me = new fo(), this.Ce = (t3, i2) => this.Oe(t3, i2) && this.Fe(t3, i2) && this.Ae(t3, i2), this.Oe = (t3, i2) => null == i2 || !i2.event || (null == t3 ? void 0 : t3.event) === (null == i2 ? void 0 : i2.event), this._instance = t2, this.De = /* @__PURE__ */ new Set(), this.Le = /* @__PURE__ */ new Set();
  }
  init() {
    var t2;
    if (!R(null == (t2 = this._instance) ? void 0 : t2.Ne)) {
      var i2;
      null == (i2 = this._instance) || i2.Ne((t3, i3) => {
        this.on(t3, i3);
      });
    }
  }
  register(t2) {
    var i2, e2;
    if (!R(null == (i2 = this._instance) ? void 0 : i2.Ne) && (t2.forEach((t3) => {
      var i3, e3;
      null == (i3 = this.Le) || i3.add(t3), null == (e3 = t3.steps) || e3.forEach((t4) => {
        var i4;
        null == (i4 = this.De) || i4.add((null == t4 ? void 0 : t4.event) || "");
      });
    }), null != (e2 = this._instance) && e2.autocapture)) {
      var r2, s2 = /* @__PURE__ */ new Set();
      t2.forEach((t3) => {
        var i3;
        null == (i3 = t3.steps) || i3.forEach((t4) => {
          null != t4 && t4.selector && s2.add(null == t4 ? void 0 : t4.selector);
        });
      }), null == (r2 = this._instance) || r2.autocapture.setElementSelectors(s2);
    }
  }
  on(t2, i2) {
    var e2;
    null != i2 && 0 != t2.length && (this.De.has(t2) || this.De.has(null == i2 ? void 0 : i2.event)) && this.Le && (null == (e2 = this.Le) ? void 0 : e2.size) > 0 && this.Le.forEach((t3) => {
      this.je(i2, t3) && this.Me.emit("actionCaptured", t3.name);
    });
  }
  ze(t2) {
    this.onAction("actionCaptured", (i2) => t2(i2));
  }
  je(t2, i2) {
    if (null == (null == i2 ? void 0 : i2.steps)) return false;
    for (var e2 of i2.steps) if (this.Ce(t2, e2)) return true;
    return false;
  }
  onAction(t2, i2) {
    return this.Me.on(t2, i2);
  }
  Fe(t2, i2) {
    if (null != i2 && i2.url) {
      var e2, r2 = null == t2 || null == (e2 = t2.properties) ? void 0 : e2.$current_url;
      if (!r2 || "string" != typeof r2) return false;
      if (!po.Ue(r2, null == i2 ? void 0 : i2.url, (null == i2 ? void 0 : i2.url_matching) || "contains")) return false;
    }
    return true;
  }
  static Ue(i2, e2, r2) {
    switch (r2) {
      case "regex":
        return !!t && Ns(i2, e2);
      case "exact":
        return e2 === i2;
      case "contains":
        var s2 = po.qe(e2).replace(/_/g, ".").replace(/%/g, ".*");
        return Ns(i2, s2);
      default:
        return false;
    }
  }
  static qe(t2) {
    return t2.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
  }
  Ae(t2, i2) {
    if ((null != i2 && i2.href || null != i2 && i2.tag_name || null != i2 && i2.text) && !this.Be(t2).some((t3) => !(null != i2 && i2.href && !po.Ue(t3.href || "", null == i2 ? void 0 : i2.href, (null == i2 ? void 0 : i2.href_matching) || "exact")) && (null == i2 || !i2.tag_name || t3.tag_name === (null == i2 ? void 0 : i2.tag_name)) && !(null != i2 && i2.text && !po.Ue(t3.text || "", null == i2 ? void 0 : i2.text, (null == i2 ? void 0 : i2.text_matching) || "exact") && !po.Ue(t3.$el_text || "", null == i2 ? void 0 : i2.text, (null == i2 ? void 0 : i2.text_matching) || "exact")))) return false;
    if (null != i2 && i2.selector) {
      var e2, r2 = null == t2 || null == (e2 = t2.properties) ? void 0 : e2.$element_selectors;
      if (!r2) return false;
      if (!r2.includes(null == i2 ? void 0 : i2.selector)) return false;
    }
    return true;
  }
  Be(t2) {
    return null == (null == t2 ? void 0 : t2.properties.$elements) ? [] : null == t2 ? void 0 : t2.properties.$elements;
  }
}
var go = z("[Surveys]");
class _o {
  constructor(t2) {
    this._instance = t2, this.He = /* @__PURE__ */ new Map(), this.We = /* @__PURE__ */ new Map();
  }
  register(t2) {
    var i2;
    R(null == (i2 = this._instance) ? void 0 : i2.Ne) || (this.Ge(t2), this.Je(t2));
  }
  Je(t2) {
    var i2 = t2.filter((t3) => {
      var i3, e2;
      return (null == (i3 = t3.conditions) ? void 0 : i3.actions) && (null == (e2 = t3.conditions) || null == (e2 = e2.actions) || null == (e2 = e2.values) ? void 0 : e2.length) > 0;
    });
    if (0 !== i2.length) {
      if (null == this.Ve) {
        this.Ve = new po(this._instance), this.Ve.init();
        this.Ve.ze((t3) => {
          this.onAction(t3);
        });
      }
      i2.forEach((t3) => {
        var i3, e2, r2, s2, n2;
        t3.conditions && null != (i3 = t3.conditions) && i3.actions && null != (e2 = t3.conditions) && null != (e2 = e2.actions) && e2.values && (null == (r2 = t3.conditions) || null == (r2 = r2.actions) || null == (r2 = r2.values) ? void 0 : r2.length) > 0 && (null == (s2 = this.Ve) || s2.register(t3.conditions.actions.values), null == (n2 = t3.conditions) || null == (n2 = n2.actions) || null == (n2 = n2.values) || n2.forEach((i4) => {
          if (i4 && i4.name) {
            var e3 = this.We.get(i4.name);
            e3 && e3.push(t3.id), this.We.set(i4.name, e3 || [t3.id]);
          }
        }));
      });
    }
  }
  Ge(t2) {
    var i2;
    if (0 !== t2.filter((t3) => {
      var i3, e2;
      return (null == (i3 = t3.conditions) ? void 0 : i3.events) && (null == (e2 = t3.conditions) || null == (e2 = e2.events) || null == (e2 = e2.values) ? void 0 : e2.length) > 0;
    }).length) {
      null == (i2 = this._instance) || i2.Ne((t3, i3) => {
        this.onEvent(t3, i3);
      }), t2.forEach((t3) => {
        var i3;
        null == (i3 = t3.conditions) || null == (i3 = i3.events) || null == (i3 = i3.values) || i3.forEach((i4) => {
          if (i4 && i4.name) {
            var e2 = this.He.get(i4.name);
            e2 && e2.push(t3.id), this.He.set(i4.name, e2 || [t3.id]);
          }
        });
      });
    }
  }
  onEvent(t2, i2) {
    var e2, r2 = (null == (e2 = this._instance) || null == (e2 = e2.persistence) ? void 0 : e2.props[Ot]) || [];
    if ("survey shown" === t2 && i2 && r2.length > 0) {
      var s2;
      go.info("survey event matched, removing survey from activated surveys", {
        event: t2,
        eventPayload: i2,
        existingActivatedSurveys: r2
      });
      var n2 = null == i2 || null == (s2 = i2.properties) ? void 0 : s2.$survey_id;
      if (n2) {
        var o2 = r2.indexOf(n2);
        o2 >= 0 && (r2.splice(o2, 1), this.Ke(r2));
      }
    } else this.He.has(t2) && (go.info("survey event matched, updating activated surveys", {
      event: t2,
      surveys: this.He.get(t2)
    }), this.Ke(r2.concat(this.He.get(t2) || [])));
  }
  onAction(t2) {
    var i2, e2 = (null == (i2 = this._instance) || null == (i2 = i2.persistence) ? void 0 : i2.props[Ot]) || [];
    this.We.has(t2) && this.Ke(e2.concat(this.We.get(t2) || []));
  }
  Ke(t2) {
    var i2;
    null == (i2 = this._instance) || null == (i2 = i2.persistence) || i2.register({
      [Ot]: [...new Set(t2)]
    });
  }
  getSurveys() {
    var t2, i2 = null == (t2 = this._instance) || null == (t2 = t2.persistence) ? void 0 : t2.props[Ot];
    return i2 || [];
  }
  getEventToSurveys() {
    return this.He;
  }
  Ye() {
    return this.Ve;
  }
}
class mo {
  constructor(t2) {
    this.Xe = null, this.Qe = false, this.Ze = false, this.tr = [], this._instance = t2, this._surveyEventReceiver = null;
  }
  onRemoteConfig(t2) {
    var i2 = t2.surveys;
    if (O(i2)) return go.warn("Decide not loaded yet. Not loading surveys.");
    var e2 = x(i2);
    this.ir = e2 ? i2.length > 0 : i2, go.info("decide response received, hasSurveys: " + this.ir), this.ir && this.loadIfEnabled();
  }
  reset() {
    localStorage.removeItem("lastSeenSurveyDate");
    for (var t2 = [], i2 = 0; i2 < localStorage.length; i2++) {
      var e2 = localStorage.key(i2);
      (null != e2 && e2.startsWith("seenSurvey_") || null != e2 && e2.startsWith("inProgressSurvey_")) && t2.push(e2);
    }
    t2.forEach((t3) => localStorage.removeItem(t3));
  }
  loadIfEnabled() {
    if (!this.Xe) if (this.Ze) go.info("Already initializing surveys, skipping...");
    else if (this._instance.config.disable_surveys) go.info("Disabled. Not loading surveys.");
    else if (this.ir) {
      var t2 = null == v ? void 0 : v.__PosthogExtensions__;
      if (t2) {
        this.Ze = true;
        try {
          var i2 = t2.generateSurveys;
          if (i2) return void this.er(i2);
          var e2 = t2.loadExternalDependency;
          if (!e2) return void this.rr("PostHog loadExternalDependency extension not found.");
          e2(this._instance, "surveys", (i3) => {
            i3 || !t2.generateSurveys ? this.rr("Could not load surveys script", i3) : this.er(t2.generateSurveys);
          });
        } catch (t3) {
          throw this.rr("Error initializing surveys", t3), t3;
        } finally {
          this.Ze = false;
        }
      } else go.error("PostHog Extensions not found.");
    } else go.info("No surveys to load.");
  }
  er(t2) {
    this.Xe = t2(this._instance), this._surveyEventReceiver = new _o(this._instance), go.info("Surveys loaded successfully"), this.sr({
      isLoaded: true
    });
  }
  rr(t2, i2) {
    go.error(t2, i2), this.sr({
      isLoaded: false,
      error: t2
    });
  }
  onSurveysLoaded(t2) {
    return this.tr.push(t2), this.Xe && this.sr({
      isLoaded: true
    }), () => {
      this.tr = this.tr.filter((i2) => i2 !== t2);
    };
  }
  getSurveys(t2, i2) {
    if (void 0 === i2 && (i2 = false), this._instance.config.disable_surveys) return go.info("Disabled. Not loading surveys."), t2([]);
    var e2 = this._instance.get_property(Ct);
    if (e2 && !i2) return t2(e2, {
      isLoaded: true
    });
    if (this.Qe) return t2([], {
      isLoaded: false,
      error: "Surveys are already being loaded"
    });
    try {
      this.Qe = true, this._instance.me({
        url: this._instance.requestRouter.endpointFor("api", "/api/surveys/?token=" + this._instance.config.token),
        method: "GET",
        timeout: this._instance.config.surveys_request_timeout_ms,
        callback: (i3) => {
          var e3;
          this.Qe = false;
          var r2 = i3.statusCode;
          if (200 !== r2 || !i3.json) {
            var s2 = "Surveys API could not be loaded, status: " + r2;
            return go.error(s2), t2([], {
              isLoaded: false,
              error: s2
            });
          }
          var n2, o2 = i3.json.surveys || [], a2 = o2.filter((t3) => (function(t4) {
            return !(!t4.start_date || t4.end_date);
          })(t3) && ((function(t4) {
            var i4;
            return !(null == (i4 = t4.conditions) || null == (i4 = i4.events) || null == (i4 = i4.values) || !i4.length);
          })(t3) || (function(t4) {
            var i4;
            return !(null == (i4 = t4.conditions) || null == (i4 = i4.actions) || null == (i4 = i4.values) || !i4.length);
          })(t3)));
          a2.length > 0 && (null == (n2 = this._surveyEventReceiver) || n2.register(a2));
          return null == (e3 = this._instance.persistence) || e3.register({
            [Ct]: o2
          }), t2(o2, {
            isLoaded: true
          });
        }
      });
    } catch (t3) {
      throw this.Qe = false, t3;
    }
  }
  sr(t2) {
    for (var i2 of this.tr) try {
      t2.isLoaded ? this.getSurveys(i2) : i2([], t2);
    } catch (t3) {
      go.error("Error in survey callback", t3);
    }
  }
  getActiveMatchingSurveys(t2, i2) {
    if (void 0 === i2 && (i2 = false), !O(this.Xe)) return this.Xe.getActiveMatchingSurveys(t2, i2);
    go.warn("init was not called");
  }
  nr(t2) {
    var i2 = null;
    return this.getSurveys((e2) => {
      var r2;
      i2 = null !== (r2 = e2.find((i3) => i3.id === t2)) && void 0 !== r2 ? r2 : null;
    }), i2;
  }
  ar(t2) {
    if (O(this.Xe)) return {
      eligible: false,
      reason: "SDK is not enabled or survey functionality is not yet loaded"
    };
    var i2 = "string" == typeof t2 ? this.nr(t2) : t2;
    return i2 ? this.Xe.checkSurveyEligibility(i2) : {
      eligible: false,
      reason: "Survey not found"
    };
  }
  canRenderSurvey(t2) {
    if (O(this.Xe)) return go.warn("init was not called"), {
      visible: false,
      disabledReason: "SDK is not enabled or survey functionality is not yet loaded"
    };
    var i2 = this.ar(t2);
    return {
      visible: i2.eligible,
      disabledReason: i2.reason
    };
  }
  canRenderSurveyAsync(t2, i2) {
    return O(this.Xe) ? (go.warn("init was not called"), Promise.resolve({
      visible: false,
      disabledReason: "SDK is not enabled or survey functionality is not yet loaded"
    })) : new Promise((e2) => {
      this.getSurveys((i3) => {
        var r2, s2 = null !== (r2 = i3.find((i4) => i4.id === t2)) && void 0 !== r2 ? r2 : null;
        if (s2) {
          var n2 = this.ar(s2);
          e2({
            visible: n2.eligible,
            disabledReason: n2.reason
          });
        } else e2({
          visible: false,
          disabledReason: "Survey not found"
        });
      }, i2);
    });
  }
  renderSurvey(t2, i2) {
    if (O(this.Xe)) go.warn("init was not called");
    else {
      var e2 = this.nr(t2), r2 = null == o ? void 0 : o.querySelector(i2);
      e2 ? r2 ? this.Xe.renderSurvey(e2, r2) : go.warn("Survey element not found") : go.warn("Survey not found");
    }
  }
}
var bo = z("[RateLimiter]");
class wo {
  constructor(t2) {
    var i2, e2;
    this.serverLimits = {}, this.lastEventRateLimited = false, this.checkForLimiting = (t3) => {
      var i3 = t3.text;
      if (i3 && i3.length) try {
        (JSON.parse(i3).quota_limited || []).forEach((t4) => {
          bo.info((t4 || "events") + " is quota limited."), this.serverLimits[t4] = (/* @__PURE__ */ new Date()).getTime() + 6e4;
        });
      } catch (t4) {
        return void bo.warn('could not rate limit - continuing. Error: "' + (null == t4 ? void 0 : t4.message) + '"', {
          text: i3
        });
      }
    }, this.instance = t2, this.captureEventsPerSecond = (null == (i2 = t2.config.rate_limiting) ? void 0 : i2.events_per_second) || 10, this.captureEventsBurstLimit = Math.max((null == (e2 = t2.config.rate_limiting) ? void 0 : e2.events_burst_limit) || 10 * this.captureEventsPerSecond, this.captureEventsPerSecond), this.lastEventRateLimited = this.clientRateLimitContext(true).isRateLimited;
  }
  clientRateLimitContext(t2) {
    var i2, e2, r2;
    void 0 === t2 && (t2 = false);
    var s2 = (/* @__PURE__ */ new Date()).getTime(), n2 = null !== (i2 = null == (e2 = this.instance.persistence) ? void 0 : e2.get_property(Lt)) && void 0 !== i2 ? i2 : {
      tokens: this.captureEventsBurstLimit,
      last: s2
    };
    n2.tokens += (s2 - n2.last) / 1e3 * this.captureEventsPerSecond, n2.last = s2, n2.tokens > this.captureEventsBurstLimit && (n2.tokens = this.captureEventsBurstLimit);
    var o2 = n2.tokens < 1;
    return o2 || t2 || (n2.tokens = Math.max(0, n2.tokens - 1)), !o2 || this.lastEventRateLimited || t2 || this.instance.capture("$$client_ingestion_warning", {
      $$client_ingestion_warning_message: "posthog-js client rate limited. Config is set to " + this.captureEventsPerSecond + " events per second and " + this.captureEventsBurstLimit + " events burst limit."
    }, {
      skip_client_rate_limiting: true
    }), this.lastEventRateLimited = o2, null == (r2 = this.instance.persistence) || r2.set_property(Lt, n2), {
      isRateLimited: o2,
      remainingTokens: n2.tokens
    };
  }
  isServerRateLimited(t2) {
    var i2 = this.serverLimits[t2 || "events"] || false;
    return false !== i2 && (/* @__PURE__ */ new Date()).getTime() < i2;
  }
}
var yo = z("[RemoteConfig]");
class So {
  constructor(t2) {
    this._instance = t2;
  }
  get remoteConfig() {
    var t2;
    return null == (t2 = v._POSTHOG_REMOTE_CONFIG) || null == (t2 = t2[this._instance.config.token]) ? void 0 : t2.config;
  }
  lr(t2) {
    var i2, e2;
    null != (i2 = v.__PosthogExtensions__) && i2.loadExternalDependency ? null == (e2 = v.__PosthogExtensions__) || null == e2.loadExternalDependency || e2.loadExternalDependency(this._instance, "remote-config", () => t2(this.remoteConfig)) : (yo.error("PostHog Extensions not found. Cannot load remote config."), t2());
  }
  ur(t2) {
    this._instance.me({
      method: "GET",
      url: this._instance.requestRouter.endpointFor("assets", "/array/" + this._instance.config.token + "/config"),
      callback: (i2) => {
        t2(i2.json);
      }
    });
  }
  load() {
    try {
      if (this.remoteConfig) return yo.info("Using preloaded remote config", this.remoteConfig), void this.be(this.remoteConfig);
      if (this._instance.config.advanced_disable_decide) return void yo.warn("Remote config is disabled. Falling back to local config.");
      this.lr((t2) => {
        if (!t2) return yo.info("No config found after loading remote JS config. Falling back to JSON."), void this.ur((t3) => {
          this.be(t3);
        });
        this.be(t2);
      });
    } catch (t2) {
      yo.error("Error loading remote config", t2);
    }
  }
  be(t2) {
    t2 ? this._instance.config.__preview_remote_config ? (this._instance.be(t2), false !== t2.hasFeatureFlags && this._instance.featureFlags.ensureFlagsLoaded()) : yo.info("__preview_remote_config is disabled. Logging config instead", t2) : yo.error("Failed to fetch remote config from PostHog.");
  }
}
var $o = 3e3;
class ko {
  constructor(t2, i2) {
    this.hr = true, this.dr = [], this.vr = Xe((null == i2 ? void 0 : i2.flush_interval_ms) || $o, 250, 5e3, "flush interval", $o), this.cr = t2;
  }
  enqueue(t2) {
    this.dr.push(t2), this.pr || this.gr();
  }
  unload() {
    this._r();
    var t2 = this.dr.length > 0 ? this.mr() : {}, i2 = Object.values(t2);
    [...i2.filter((t3) => 0 === t3.url.indexOf("/e")), ...i2.filter((t3) => 0 !== t3.url.indexOf("/e"))].map((t3) => {
      this.cr(B({}, t3, {
        transport: "sendBeacon"
      }));
    });
  }
  enable() {
    this.hr = false, this.gr();
  }
  gr() {
    var t2 = this;
    this.hr || (this.pr = setTimeout(() => {
      if (this._r(), this.dr.length > 0) {
        var i2 = this.mr(), e2 = function() {
          var e3 = i2[r2], s2 = (/* @__PURE__ */ new Date()).getTime();
          e3.data && x(e3.data) && J(e3.data, (t3) => {
            t3.offset = Math.abs(t3.timestamp - s2), delete t3.timestamp;
          }), t2.cr(e3);
        };
        for (var r2 in i2) e2();
      }
    }, this.vr));
  }
  _r() {
    clearTimeout(this.pr), this.pr = void 0;
  }
  mr() {
    var t2 = {};
    return J(this.dr, (i2) => {
      var e2, r2 = i2, s2 = (r2 ? r2.batchKey : null) || r2.url;
      R(t2[s2]) && (t2[s2] = B({}, r2, {
        data: []
      })), null == (e2 = t2[s2].data) || e2.push(r2.data);
    }), this.dr = [], t2;
  }
}
var xo = ["retriesPerformedSoFar"];
class Eo {
  constructor(i2) {
    this.br = false, this.wr = 3e3, this.dr = [], this._instance = i2, this.dr = [], this.yr = true, !R(t) && "onLine" in t.navigator && (this.yr = t.navigator.onLine, st(t, "online", () => {
      this.yr = true, this.Yi();
    }), st(t, "offline", () => {
      this.yr = false;
    }));
  }
  get length() {
    return this.dr.length;
  }
  retriableRequest(t2) {
    var {
      retriesPerformedSoFar: i2
    } = t2, e2 = H(t2, xo);
    F(i2) && i2 > 0 && (e2.url = Fs(e2.url, {
      retry_count: i2
    })), this._instance.me(B({}, e2, {
      callback: (t3) => {
        200 !== t3.statusCode && (t3.statusCode < 400 || t3.statusCode >= 500) && (null != i2 ? i2 : 0) < 10 ? this.Sr(B({
          retriesPerformedSoFar: i2
        }, e2)) : null == e2.callback || e2.callback(t3);
      }
    }));
  }
  Sr(t2) {
    var i2 = t2.retriesPerformedSoFar || 0;
    t2.retriesPerformedSoFar = i2 + 1;
    var e2 = (function(t3) {
      var i3 = 3e3 * Math.pow(2, t3), e3 = i3 / 2, r3 = Math.min(18e5, i3), s3 = (Math.random() - 0.5) * (r3 - e3);
      return Math.ceil(r3 + s3);
    })(i2), r2 = Date.now() + e2;
    this.dr.push({
      retryAt: r2,
      requestOptions: t2
    });
    var s2 = "Enqueued failed request for retry in " + e2;
    navigator.onLine || (s2 += " (Browser is offline)"), j.warn(s2), this.br || (this.br = true, this.$r());
  }
  $r() {
    this.kr && clearTimeout(this.kr), this.kr = setTimeout(() => {
      this.yr && this.dr.length > 0 && this.Yi(), this.$r();
    }, this.wr);
  }
  Yi() {
    var t2 = Date.now(), i2 = [], e2 = this.dr.filter((e3) => e3.retryAt < t2 || (i2.push(e3), false));
    if (this.dr = i2, e2.length > 0) for (var {
      requestOptions: r2
    } of e2) this.retriableRequest(r2);
  }
  unload() {
    for (var {
      requestOptions: t2
    } of (this.kr && (clearTimeout(this.kr), this.kr = void 0), this.dr)) try {
      this._instance.me(B({}, t2, {
        transport: "sendBeacon"
      }));
    } catch (t3) {
      j.error(t3);
    }
    this.dr = [];
  }
}
class Io {
  constructor(t2) {
    this.Er = () => {
      var t3, i2, e2, r2;
      this.Ir || (this.Ir = {});
      var s2 = this.scrollElement(), n2 = this.scrollY(), o2 = s2 ? Math.max(0, s2.scrollHeight - s2.clientHeight) : 0, a2 = n2 + ((null == s2 ? void 0 : s2.clientHeight) || 0), l2 = (null == s2 ? void 0 : s2.scrollHeight) || 0;
      this.Ir.lastScrollY = Math.ceil(n2), this.Ir.maxScrollY = Math.max(n2, null !== (t3 = this.Ir.maxScrollY) && void 0 !== t3 ? t3 : 0), this.Ir.maxScrollHeight = Math.max(o2, null !== (i2 = this.Ir.maxScrollHeight) && void 0 !== i2 ? i2 : 0), this.Ir.lastContentY = a2, this.Ir.maxContentY = Math.max(a2, null !== (e2 = this.Ir.maxContentY) && void 0 !== e2 ? e2 : 0), this.Ir.maxContentHeight = Math.max(l2, null !== (r2 = this.Ir.maxContentHeight) && void 0 !== r2 ? r2 : 0);
    }, this._instance = t2;
  }
  getContext() {
    return this.Ir;
  }
  resetContext() {
    var t2 = this.Ir;
    return setTimeout(this.Er, 0), t2;
  }
  startMeasuringScrollPosition() {
    st(t, "scroll", this.Er, {
      capture: true
    }), st(t, "scrollend", this.Er, {
      capture: true
    }), st(t, "resize", this.Er);
  }
  scrollElement() {
    if (!this._instance.config.scroll_root_selector) return null == t ? void 0 : t.document.documentElement;
    var i2 = x(this._instance.config.scroll_root_selector) ? this._instance.config.scroll_root_selector : [this._instance.config.scroll_root_selector];
    for (var e2 of i2) {
      var r2 = null == t ? void 0 : t.document.querySelector(e2);
      if (r2) return r2;
    }
  }
  scrollY() {
    if (this._instance.config.scroll_root_selector) {
      var i2 = this.scrollElement();
      return i2 && i2.scrollTop || 0;
    }
    return t && (t.scrollY || t.pageYOffset || t.document.documentElement.scrollTop) || 0;
  }
  scrollX() {
    if (this._instance.config.scroll_root_selector) {
      var i2 = this.scrollElement();
      return i2 && i2.scrollLeft || 0;
    }
    return t && (t.scrollX || t.pageXOffset || t.document.documentElement.scrollLeft) || 0;
  }
}
var Po = (t2) => Yn(null == t2 ? void 0 : t2.config.mask_personal_data_properties, null == t2 ? void 0 : t2.config.custom_personal_data_properties);
class Ro {
  constructor(t2, i2, e2, r2) {
    this.Pr = (t3) => {
      var i3 = this.Rr();
      if (!i3 || i3.sessionId !== t3) {
        var e3 = {
          sessionId: t3,
          props: this.Tr(this._instance)
        };
        this.Mr.register({
          [Dt]: e3
        });
      }
    }, this._instance = t2, this.Cr = i2, this.Mr = e2, this.Tr = r2 || Po, this.Cr.onSessionId(this.Pr);
  }
  Rr() {
    return this.Mr.props[Dt];
  }
  getSetOnceProps() {
    var t2, i2 = null == (t2 = this.Rr()) ? void 0 : t2.props;
    return i2 ? "r" in i2 ? Xn(i2) : {
      $referring_domain: i2.referringDomain,
      $pathname: i2.initialPathName,
      utm_source: i2.utm_source,
      utm_campaign: i2.utm_campaign,
      utm_medium: i2.utm_medium,
      utm_content: i2.utm_content,
      utm_term: i2.utm_term
    } : {};
  }
  getSessionProps() {
    var t2 = {};
    return J(Z(this.getSetOnceProps()), (i2, e2) => {
      "$current_url" === e2 && (e2 = "url"), t2["$session_entry_" + w(e2)] = i2;
    }), t2;
  }
}
var To = z("[SessionId]");
class Mo {
  constructor(t2, i2, e2) {
    var r2;
    if (this.Or = [], !t2.persistence) throw new Error("SessionIdManager requires a PostHogPersistence instance");
    if (t2.config.__preview_experimental_cookieless_mode) throw new Error("SessionIdManager cannot be used with __preview_experimental_cookieless_mode");
    this.S = t2.config, this.Mr = t2.persistence, this.oi = void 0, this.kt = void 0, this._sessionStartTimestamp = null, this._sessionActivityTimestamp = null, this.Fr = i2 || Ni, this.Ar = e2 || Ni;
    var s2 = this.S.persistence_name || this.S.token, n2 = this.S.session_idle_timeout_seconds || 1800;
    if (this._sessionTimeoutMs = 1e3 * Xe(n2, 60, 36e3, "session_idle_timeout_seconds", 1800), t2.register({
      $configured_session_timeout_ms: this._sessionTimeoutMs
    }), this.Dr(), this.Lr = "ph_" + s2 + "_window_id", this.Nr = "ph_" + s2 + "_primary_window_exists", this.jr()) {
      var o2 = Xi.D(this.Lr), a2 = Xi.D(this.Nr);
      o2 && !a2 ? this.oi = o2 : Xi.N(this.Lr), Xi.L(this.Nr, true);
    }
    if (null != (r2 = this.S.bootstrap) && r2.sessionID) try {
      var l2 = ((t3) => {
        var i3 = t3.replace(/-/g, "");
        if (32 !== i3.length) throw new Error("Not a valid UUID");
        if ("7" !== i3[12]) throw new Error("Not a UUIDv7");
        return parseInt(i3.substring(0, 12), 16);
      })(this.S.bootstrap.sessionID);
      this.zr(this.S.bootstrap.sessionID, (/* @__PURE__ */ new Date()).getTime(), l2);
    } catch (t3) {
      To.error("Invalid sessionID in bootstrap", t3);
    }
    this.Ur();
  }
  get sessionTimeoutMs() {
    return this._sessionTimeoutMs;
  }
  onSessionId(t2) {
    return R(this.Or) && (this.Or = []), this.Or.push(t2), this.kt && t2(this.kt, this.oi), () => {
      this.Or = this.Or.filter((i2) => i2 !== t2);
    };
  }
  jr() {
    return "memory" !== this.S.persistence && !this.Mr.xe && Xi.O();
  }
  qr(t2) {
    t2 !== this.oi && (this.oi = t2, this.jr() && Xi.L(this.Lr, t2));
  }
  Br() {
    return this.oi ? this.oi : this.jr() ? Xi.D(this.Lr) : null;
  }
  zr(t2, i2, e2) {
    t2 === this.kt && i2 === this._sessionActivityTimestamp && e2 === this._sessionStartTimestamp || (this._sessionStartTimestamp = e2, this._sessionActivityTimestamp = i2, this.kt = t2, this.Mr.register({
      [$t]: [i2, t2, e2]
    }));
  }
  Hr() {
    if (this.kt && this._sessionActivityTimestamp && this._sessionStartTimestamp) return [this._sessionActivityTimestamp, this.kt, this._sessionStartTimestamp];
    var t2 = this.Mr.props[$t];
    return x(t2) && 2 === t2.length && t2.push(t2[0]), t2 || [0, null, 0];
  }
  resetSessionId() {
    this.zr(null, null, null);
  }
  Ur() {
    st(t, "beforeunload", () => {
      this.jr() && Xi.N(this.Nr);
    }, {
      capture: false
    });
  }
  checkAndGetSessionAndWindowId(t2, i2) {
    if (void 0 === t2 && (t2 = false), void 0 === i2 && (i2 = null), this.S.__preview_experimental_cookieless_mode) throw new Error("checkAndGetSessionAndWindowId should not be called in __preview_experimental_cookieless_mode");
    var e2 = i2 || (/* @__PURE__ */ new Date()).getTime(), [r2, s2, n2] = this.Hr(), o2 = this.Br(), a2 = F(n2) && n2 > 0 && Math.abs(e2 - n2) > 864e5, l2 = false, u2 = !s2, h2 = !t2 && Math.abs(e2 - r2) > this.sessionTimeoutMs;
    u2 || h2 || a2 ? (s2 = this.Fr(), o2 = this.Ar(), To.info("new session ID generated", {
      sessionId: s2,
      windowId: o2,
      changeReason: {
        noSessionId: u2,
        activityTimeout: h2,
        sessionPastMaximumLength: a2
      }
    }), n2 = e2, l2 = true) : o2 || (o2 = this.Ar(), l2 = true);
    var d2 = 0 === r2 || !t2 || a2 ? e2 : r2, v2 = 0 === n2 ? (/* @__PURE__ */ new Date()).getTime() : n2;
    return this.qr(o2), this.zr(s2, d2, v2), t2 || this.Dr(), l2 && this.Or.forEach((t3) => t3(s2, o2, l2 ? {
      noSessionId: u2,
      activityTimeout: h2,
      sessionPastMaximumLength: a2
    } : void 0)), {
      sessionId: s2,
      windowId: o2,
      sessionStartTimestamp: v2,
      changeReason: l2 ? {
        noSessionId: u2,
        activityTimeout: h2,
        sessionPastMaximumLength: a2
      } : void 0,
      lastActivityTimestamp: r2
    };
  }
  Dr() {
    clearTimeout(this.Wr), this.Wr = setTimeout(() => {
      this.resetSessionId();
    }, 1.1 * this.sessionTimeoutMs);
  }
}
var Co = ["$set_once", "$set"], Oo = z("[SiteApps]");
class Fo {
  constructor(t2) {
    this._instance = t2, this.Gr = [], this.apps = {};
  }
  get isEnabled() {
    return !!this._instance.config.opt_in_site_apps;
  }
  Jr(t2, i2) {
    if (i2) {
      var e2 = this.globalsForEvent(i2);
      this.Gr.push(e2), this.Gr.length > 1e3 && (this.Gr = this.Gr.slice(10));
    }
  }
  get siteAppLoaders() {
    var t2;
    return null == (t2 = v._POSTHOG_REMOTE_CONFIG) || null == (t2 = t2[this._instance.config.token]) ? void 0 : t2.siteApps;
  }
  init() {
    if (this.isEnabled) {
      var t2 = this._instance.Ne(this.Jr.bind(this));
      this.Vr = () => {
        t2(), this.Gr = [], this.Vr = void 0;
      };
    }
  }
  globalsForEvent(t2) {
    var i2, e2, r2, s2, n2, o2, a2;
    if (!t2) throw new Error("Event payload is required");
    var l2 = {}, u2 = this._instance.get_property("$groups") || [], h2 = this._instance.get_property("$stored_group_properties") || {};
    for (var [d2, v2] of Object.entries(h2)) l2[d2] = {
      id: u2[d2],
      type: d2,
      properties: v2
    };
    var {
      $set_once: c2,
      $set: f2
    } = t2;
    return {
      event: B({}, H(t2, Co), {
        properties: B({}, t2.properties, f2 ? {
          $set: B({}, null !== (i2 = null == (e2 = t2.properties) ? void 0 : e2.$set) && void 0 !== i2 ? i2 : {}, f2)
        } : {}, c2 ? {
          $set_once: B({}, null !== (r2 = null == (s2 = t2.properties) ? void 0 : s2.$set_once) && void 0 !== r2 ? r2 : {}, c2)
        } : {}),
        elements_chain: null !== (n2 = null == (o2 = t2.properties) ? void 0 : o2.$elements_chain) && void 0 !== n2 ? n2 : "",
        distinct_id: null == (a2 = t2.properties) ? void 0 : a2.distinct_id
      }),
      person: {
        properties: this._instance.get_property("$stored_person_properties")
      },
      groups: l2
    };
  }
  setupSiteApp(t2) {
    var i2 = this.apps[t2.id], e2 = () => {
      var e3;
      (!i2.errored && this.Gr.length && (Oo.info("Processing " + this.Gr.length + " events for site app with id " + t2.id), this.Gr.forEach((t3) => null == i2.processEvent ? void 0 : i2.processEvent(t3)), i2.processedBuffer = true), Object.values(this.apps).every((t3) => t3.processedBuffer || t3.errored)) && (null == (e3 = this.Vr) || e3.call(this));
    }, r2 = false, s2 = (s3) => {
      i2.errored = !s3, i2.loaded = true, Oo.info("Site app with id " + t2.id + " " + (s3 ? "loaded" : "errored")), r2 && e2();
    };
    try {
      var {
        processEvent: n2
      } = t2.init({
        posthog: this._instance,
        callback: (t3) => {
          s2(t3);
        }
      });
      n2 && (i2.processEvent = n2), r2 = true;
    } catch (i3) {
      Oo.error("Error while initializing PostHog app with config id " + t2.id, i3), s2(false);
    }
    if (r2 && i2.loaded) try {
      e2();
    } catch (e3) {
      Oo.error("Error while processing buffered events PostHog app with config id " + t2.id, e3), i2.errored = true;
    }
  }
  Kr() {
    var t2 = this.siteAppLoaders || [];
    for (var i2 of t2) this.apps[i2.id] = {
      id: i2.id,
      loaded: false,
      errored: false,
      processedBuffer: false
    };
    for (var e2 of t2) this.setupSiteApp(e2);
  }
  Yr(t2) {
    if (0 !== Object.keys(this.apps).length) {
      var i2 = this.globalsForEvent(t2);
      for (var e2 of Object.values(this.apps)) try {
        null == e2.processEvent || e2.processEvent(i2);
      } catch (i3) {
        Oo.error("Error while processing event " + t2.event + " for site app " + e2.id, i3);
      }
    }
  }
  onRemoteConfig(t2) {
    var i2, e2, r2, s2 = this;
    if (null != (i2 = this.siteAppLoaders) && i2.length) return this.isEnabled ? (this.Kr(), void this._instance.on("eventCaptured", (t3) => this.Yr(t3))) : void Oo.error('PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.');
    if (null == (e2 = this.Vr) || e2.call(this), null != (r2 = t2.siteApps) && r2.length) if (this.isEnabled) {
      var n2 = function(t3) {
        var i3;
        v["__$$ph_site_app_" + t3] = s2._instance, null == (i3 = v.__PosthogExtensions__) || null == i3.loadSiteApp || i3.loadSiteApp(s2._instance, a2, (i4) => {
          if (i4) return Oo.error("Error while initializing PostHog app with config id " + t3, i4);
        });
      };
      for (var {
        id: o2,
        url: a2
      } of t2.siteApps) n2(o2);
    } else Oo.error('PostHog site apps are disabled. Enable the "opt_in_site_apps" config to proceed.');
  }
}
var Ao = ["amazonbot", "amazonproductbot", "app.hypefactors.com", "applebot", "archive.org_bot", "awariobot", "backlinksextendedbot", "baiduspider", "bingbot", "bingpreview", "chrome-lighthouse", "dataforseobot", "deepscan", "duckduckbot", "facebookexternal", "facebookcatalog", "http://yandex.com/bots", "hubspot", "ia_archiver", "linkedinbot", "meta-externalagent", "mj12bot", "msnbot", "nessus", "petalbot", "pinterest", "prerender", "rogerbot", "screaming frog", "sebot-wa", "sitebulb", "slackbot", "slurp", "trendictionbot", "turnitin", "twitterbot", "vercelbot", "yahoo! slurp", "yandexbot", "zoombot", "bot.htm", "bot.php", "(bot;", "bot/", "crawler", "ahrefsbot", "ahrefssiteaudit", "semrushbot", "siteauditbot", "splitsignalbot", "gptbot", "oai-searchbot", "chatgpt-user", "perplexitybot", "better uptime bot", "sentryuptimebot", "uptimerobot", "headlesschrome", "cypress", "google-hoteladsverifier", "adsbot-google", "apis-google", "duplexweb-google", "feedfetcher-google", "google favicon", "google web preview", "google-read-aloud", "googlebot", "googleother", "google-cloudvertexbot", "googleweblight", "mediapartners-google", "storebot-google", "google-inspectiontool", "bytespider"], Do = function(t2, i2) {
  if (!t2) return false;
  var e2 = t2.toLowerCase();
  return Ao.concat(i2 || []).some((t3) => {
    var i3 = t3.toLowerCase();
    return -1 !== e2.indexOf(i3);
  });
}, Lo = function(t2, i2) {
  if (!t2) return false;
  var e2 = t2.userAgent;
  if (e2 && Do(e2, i2)) return true;
  try {
    var r2 = null == t2 ? void 0 : t2.userAgentData;
    if (null != r2 && r2.brands && r2.brands.some((t3) => Do(null == t3 ? void 0 : t3.brand, i2))) return true;
  } catch (t3) {
  }
  return !!t2.webdriver;
}, No = (function(t2) {
  return t2.US = "us", t2.EU = "eu", t2.CUSTOM = "custom", t2;
})({}), jo = "i.posthog.com";
class zo {
  constructor(t2) {
    this.Xr = {}, this.instance = t2;
  }
  get apiHost() {
    var t2 = this.instance.config.api_host.trim().replace(/\/$/, "");
    return "https://app.posthog.com" === t2 ? "https://us.i.posthog.com" : t2;
  }
  get uiHost() {
    var t2, i2 = null == (t2 = this.instance.config.ui_host) ? void 0 : t2.replace(/\/$/, "");
    return i2 || (i2 = this.apiHost.replace("." + jo, ".posthog.com")), "https://app.posthog.com" === i2 ? "https://us.posthog.com" : i2;
  }
  get region() {
    return this.Xr[this.apiHost] || (/https:\/\/(app|us|us-assets)(\.i)?\.posthog\.com/i.test(this.apiHost) ? this.Xr[this.apiHost] = No.US : /https:\/\/(eu|eu-assets)(\.i)?\.posthog\.com/i.test(this.apiHost) ? this.Xr[this.apiHost] = No.EU : this.Xr[this.apiHost] = No.CUSTOM), this.Xr[this.apiHost];
  }
  endpointFor(t2, i2) {
    if (void 0 === i2 && (i2 = ""), i2 && (i2 = "/" === i2[0] ? i2 : "/" + i2), "ui" === t2) return this.uiHost + i2;
    if (this.region === No.CUSTOM) return this.apiHost + i2;
    var e2 = jo + i2;
    switch (t2) {
      case "assets":
        return "https://" + this.region + "-assets." + e2;
      case "api":
        return "https://" + this.region + "." + e2;
    }
  }
}
var Uo = {
  icontains: (i2, e2) => !!t && e2.href.toLowerCase().indexOf(i2.toLowerCase()) > -1,
  not_icontains: (i2, e2) => !!t && -1 === e2.href.toLowerCase().indexOf(i2.toLowerCase()),
  regex: (i2, e2) => !!t && Ns(e2.href, i2),
  not_regex: (i2, e2) => !!t && !Ns(e2.href, i2),
  exact: (t2, i2) => i2.href === t2,
  is_not: (t2, i2) => i2.href !== t2
};
class qo {
  constructor(t2) {
    var i2 = this;
    this.getWebExperimentsAndEvaluateDisplayLogic = function(t3) {
      void 0 === t3 && (t3 = false), i2.getWebExperiments((t4) => {
        qo.Qr("retrieved web experiments from the server"), i2.Zr = /* @__PURE__ */ new Map(), t4.forEach((t5) => {
          if (t5.feature_flag_key) {
            var e2;
            if (i2.Zr) qo.Qr("setting flag key ", t5.feature_flag_key, " to web experiment ", t5), null == (e2 = i2.Zr) || e2.set(t5.feature_flag_key, t5);
            var r2 = i2._instance.getFeatureFlag(t5.feature_flag_key);
            T(r2) && t5.variants[r2] && i2.ts(t5.name, r2, t5.variants[r2].transforms);
          } else if (t5.variants) for (var s2 in t5.variants) {
            var n2 = t5.variants[s2];
            qo.es(n2) && i2.ts(t5.name, s2, n2.transforms);
          }
        });
      }, t3);
    }, this._instance = t2, this._instance.onFeatureFlags((t3) => {
      this.onFeatureFlags(t3);
    });
  }
  onFeatureFlags(t2) {
    if (this._is_bot()) qo.Qr("Refusing to render web experiment since the viewer is a likely bot");
    else if (!this._instance.config.disable_web_experiments) {
      if (O(this.Zr)) return this.Zr = /* @__PURE__ */ new Map(), this.loadIfEnabled(), void this.previewWebExperiment();
      qo.Qr("applying feature flags", t2), t2.forEach((t3) => {
        var i2;
        if (this.Zr && null != (i2 = this.Zr) && i2.has(t3)) {
          var e2, r2 = this._instance.getFeatureFlag(t3), s2 = null == (e2 = this.Zr) ? void 0 : e2.get(t3);
          r2 && null != s2 && s2.variants[r2] && this.ts(s2.name, r2, s2.variants[r2].transforms);
        }
      });
    }
  }
  previewWebExperiment() {
    var t2 = qo.getWindowLocation();
    if (null != t2 && t2.search) {
      var i2 = $i(null == t2 ? void 0 : t2.search, "__experiment_id"), e2 = $i(null == t2 ? void 0 : t2.search, "__experiment_variant");
      i2 && e2 && (qo.Qr("previewing web experiments " + i2 + " && " + e2), this.getWebExperiments((t3) => {
        this.rs(parseInt(i2), e2, t3);
      }, false, true));
    }
  }
  loadIfEnabled() {
    this._instance.config.disable_web_experiments || this.getWebExperimentsAndEvaluateDisplayLogic();
  }
  getWebExperiments(t2, i2, e2) {
    if (this._instance.config.disable_web_experiments && !e2) return t2([]);
    var r2 = this._instance.get_property("$web_experiments");
    if (r2 && !i2) return t2(r2);
    this._instance.me({
      url: this._instance.requestRouter.endpointFor("api", "/api/web_experiments/?token=" + this._instance.config.token),
      method: "GET",
      callback: (i3) => {
        if (200 !== i3.statusCode || !i3.json) return t2([]);
        var e3 = i3.json.experiments || [];
        return t2(e3);
      }
    });
  }
  rs(t2, i2, e2) {
    var r2 = e2.filter((i3) => i3.id === t2);
    r2 && r2.length > 0 && (qo.Qr("Previewing web experiment [" + r2[0].name + "] with variant [" + i2 + "]"), this.ts(r2[0].name, i2, r2[0].variants[i2].transforms));
  }
  static es(t2) {
    return !O(t2.conditions) && qo.ss(t2) && qo.ns(t2);
  }
  static ss(t2) {
    var i2;
    if (O(t2.conditions) || O(null == (i2 = t2.conditions) ? void 0 : i2.url)) return true;
    var e2, r2, s2, n2 = qo.getWindowLocation();
    return !!n2 && (null == (e2 = t2.conditions) || !e2.url || Uo[null !== (r2 = null == (s2 = t2.conditions) ? void 0 : s2.urlMatchType) && void 0 !== r2 ? r2 : "icontains"](t2.conditions.url, n2));
  }
  static getWindowLocation() {
    return null == t ? void 0 : t.location;
  }
  static ns(t2) {
    var i2;
    if (O(t2.conditions) || O(null == (i2 = t2.conditions) ? void 0 : i2.utm)) return true;
    var e2 = Wn();
    if (e2.utm_source) {
      var r2, s2, n2, o2, a2, l2, u2, h2, d2 = null == (r2 = t2.conditions) || null == (r2 = r2.utm) || !r2.utm_campaign || (null == (s2 = t2.conditions) || null == (s2 = s2.utm) ? void 0 : s2.utm_campaign) == e2.utm_campaign, v2 = null == (n2 = t2.conditions) || null == (n2 = n2.utm) || !n2.utm_source || (null == (o2 = t2.conditions) || null == (o2 = o2.utm) ? void 0 : o2.utm_source) == e2.utm_source, c2 = null == (a2 = t2.conditions) || null == (a2 = a2.utm) || !a2.utm_medium || (null == (l2 = t2.conditions) || null == (l2 = l2.utm) ? void 0 : l2.utm_medium) == e2.utm_medium, f2 = null == (u2 = t2.conditions) || null == (u2 = u2.utm) || !u2.utm_term || (null == (h2 = t2.conditions) || null == (h2 = h2.utm) ? void 0 : h2.utm_term) == e2.utm_term;
      return d2 && c2 && f2 && v2;
    }
    return false;
  }
  static Qr(t2) {
    for (var i2 = arguments.length, e2 = new Array(i2 > 1 ? i2 - 1 : 0), r2 = 1; r2 < i2; r2++) e2[r2 - 1] = arguments[r2];
    j.info("[WebExperiments] " + t2, e2);
  }
  ts(t2, i2, e2) {
    this._is_bot() ? qo.Qr("Refusing to render web experiment since the viewer is a likely bot") : "control" !== i2 ? e2.forEach((e3) => {
      if (e3.selector) {
        var r2;
        qo.Qr("applying transform of variant " + i2 + " for experiment " + t2 + " ", e3);
        var s2 = null == (r2 = document) ? void 0 : r2.querySelectorAll(e3.selector);
        null == s2 || s2.forEach((t3) => {
          var i3 = t3;
          e3.html && (i3.innerHTML = e3.html), e3.css && i3.setAttribute("style", e3.css);
        });
      }
    }) : qo.Qr("Control variants leave the page unmodified.");
  }
  _is_bot() {
    return n && this._instance ? Lo(n, this._instance.config.custom_blocked_useragents) : void 0;
  }
}
var Bo = {}, Ho = () => {
}, Wo = "posthog", Go = !Cs && -1 === (null == d ? void 0 : d.indexOf("MSIE")) && -1 === (null == d ? void 0 : d.indexOf("Mozilla")), Jo = (i2) => {
  var e2;
  return {
    api_host: "https://us.i.posthog.com",
    ui_host: null,
    token: "",
    autocapture: true,
    rageclick: true,
    cross_subdomain_cookie: et(null == o ? void 0 : o.location),
    persistence: "localStorage+cookie",
    persistence_name: "",
    loaded: Ho,
    save_campaign_params: true,
    custom_campaign_params: [],
    custom_blocked_useragents: [],
    save_referrer: true,
    capture_pageview: "2025-05-24" !== i2 || "history_change",
    capture_pageleave: "if_capture_pageview",
    defaults: null != i2 ? i2 : "unset",
    debug: a && T(null == a ? void 0 : a.search) && -1 !== a.search.indexOf("__posthog_debug=true") || false,
    cookie_expiration: 365,
    upgrade: false,
    disable_session_recording: false,
    disable_persistence: false,
    disable_web_experiments: true,
    disable_surveys: false,
    disable_external_dependency_loading: false,
    enable_recording_console_log: void 0,
    secure_cookie: "https:" === (null == t || null == (e2 = t.location) ? void 0 : e2.protocol),
    ip: true,
    opt_out_capturing_by_default: false,
    opt_out_persistence_by_default: false,
    opt_out_useragent_filter: false,
    opt_out_capturing_persistence_type: "localStorage",
    opt_out_capturing_cookie_prefix: null,
    opt_in_site_apps: false,
    property_denylist: [],
    respect_dnt: false,
    sanitize_properties: null,
    request_headers: {},
    request_batching: true,
    properties_string_max_length: 65535,
    session_recording: {},
    mask_all_element_attributes: false,
    mask_all_text: false,
    mask_personal_data_properties: false,
    custom_personal_data_properties: [],
    advanced_disable_decide: false,
    advanced_disable_feature_flags: false,
    advanced_disable_feature_flags_on_first_load: false,
    advanced_disable_toolbar_metrics: false,
    feature_flag_request_timeout_ms: 3e3,
    surveys_request_timeout_ms: 1e4,
    on_request_error: (t2) => {
      var i3 = "Bad HTTP status: " + t2.statusCode + " " + t2.text;
      j.error(i3);
    },
    get_device_id: (t2) => t2,
    capture_performance: void 0,
    name: "posthog",
    bootstrap: {},
    disable_compression: false,
    session_idle_timeout_seconds: 1800,
    person_profiles: "identified_only",
    before_send: void 0,
    request_queue_config: {
      flush_interval_ms: $o
    },
    _onCapture: Ho
  };
}, Vo = (t2) => {
  var i2 = {};
  R(t2.process_person) || (i2.person_profiles = t2.process_person), R(t2.xhr_headers) || (i2.request_headers = t2.xhr_headers), R(t2.cookie_name) || (i2.persistence_name = t2.cookie_name), R(t2.disable_cookie) || (i2.disable_persistence = t2.disable_cookie), R(t2.store_google) || (i2.save_campaign_params = t2.store_google), R(t2.verbose) || (i2.debug = t2.verbose);
  var e2 = V({}, i2, t2);
  return x(t2.property_blacklist) && (R(t2.property_denylist) ? e2.property_denylist = t2.property_blacklist : x(t2.property_denylist) ? e2.property_denylist = [...t2.property_blacklist, ...t2.property_denylist] : j.error("Invalid value for property_denylist config: " + t2.property_denylist)), e2;
};
class Ko {
  constructor() {
    this.__forceAllowLocalhost = false;
  }
  get os() {
    return this.__forceAllowLocalhost;
  }
  set os(t2) {
    j.error("WebPerformanceObserver is deprecated and has no impact on network capture. Use `_forceAllowLocalhostNetworkCapture` on `posthog.sessionRecording`"), this.__forceAllowLocalhost = t2;
  }
}
class Yo {
  get decideEndpointWasHit() {
    var t2, i2;
    return null !== (t2 = null == (i2 = this.featureFlags) ? void 0 : i2.hasLoadedFlags) && void 0 !== t2 && t2;
  }
  constructor() {
    this.webPerformance = new Ko(), this.ls = false, this.version = c.LIB_VERSION, this.us = new fo(), this._calculate_event_properties = this.calculateEventProperties.bind(this), this.config = Jo(), this.SentryIntegration = gs, this.sentryIntegration = (t2) => (function(t3, i2) {
      var e2 = ps(t3, i2);
      return {
        name: fs,
        processEvent: (t4) => e2(t4)
      };
    })(this, t2), this.__request_queue = [], this.__loaded = false, this.analyticsDefaultEndpoint = "/e/", this.hs = false, this.ds = null, this.vs = null, this.cs = null, this.featureFlags = new ho(this), this.toolbar = new ys(this), this.scrollManager = new Io(this), this.pageViewManager = new Ts(this), this.surveys = new mo(this), this.experiments = new qo(this), this.exceptions = new Bs(this), this.rateLimiter = new wo(this), this.requestRouter = new zo(this), this.consent = new Zi(this), this.people = {
      set: (t2, i2, e2) => {
        var r2 = T(t2) ? {
          [t2]: i2
        } : t2;
        this.setPersonProperties(r2), null == e2 || e2({});
      },
      set_once: (t2, i2, e2) => {
        var r2 = T(t2) ? {
          [t2]: i2
        } : t2;
        this.setPersonProperties(void 0, r2), null == e2 || e2({});
      }
    }, this.on("eventCaptured", (t2) => j.info('send "' + (null == t2 ? void 0 : t2.event) + '"', t2));
  }
  init(t2, i2, e2) {
    if (e2 && e2 !== Wo) {
      var r2, s2 = null !== (r2 = Bo[e2]) && void 0 !== r2 ? r2 : new Yo();
      return s2._init(t2, i2, e2), Bo[e2] = s2, Bo[Wo][e2] = s2, s2;
    }
    return this._init(t2, i2, e2);
  }
  _init(i2, e2, r2) {
    var s2, n2;
    if (void 0 === e2 && (e2 = {}), R(i2) || M(i2)) return j.critical("PostHog was initialized without a token. This likely indicates a misconfiguration. Please check the first argument passed to posthog.init()"), this;
    if (this.__loaded) return j.warn("You have already initialized PostHog! Re-initializing is a no-op"), this;
    this.__loaded = true, this.config = {}, this.fs = [], e2.person_profiles && (this.vs = e2.person_profiles), this.set_config(V({}, Jo(e2.defaults), Vo(e2), {
      name: r2,
      token: i2
    })), this.config.on_xhr_error && j.error("on_xhr_error is deprecated. Use on_request_error instead"), this.compression = e2.disable_compression ? void 0 : g.GZipJS, this.persistence = new co(this.config), this.sessionPersistence = "sessionStorage" === this.config.persistence || "memory" === this.config.persistence ? this.persistence : new co(B({}, this.config, {
      persistence: "sessionStorage"
    }));
    var o2 = B({}, this.persistence.props), a2 = B({}, this.sessionPersistence.props);
    if (this.ps = new ko((t2) => this.gs(t2), this.config.request_queue_config), this._s = new Eo(this), this.__request_queue = [], this.config.__preview_experimental_cookieless_mode || (this.sessionManager = new Mo(this), this.sessionPropsManager = new Ro(this, this.sessionManager, this.persistence)), new $s(this).startIfEnabledOrStop(), this.siteApps = new Fo(this), null == (s2 = this.siteApps) || s2.init(), this.config.__preview_experimental_cookieless_mode || (this.sessionRecording = new ds(this), this.sessionRecording.startIfEnabledOrStop()), this.config.disable_scroll_properties || this.scrollManager.startMeasuringScrollPosition(), this.autocapture = new Mi(this), this.autocapture.startIfEnabled(), this.surveys.loadIfEnabled(), this.heatmaps = new Rs(this), this.heatmaps.startIfEnabled(), this.webVitalsAutocapture = new Es(this), this.exceptionObserver = new ne(this), this.exceptionObserver.startIfEnabled(), this.deadClicksAutocapture = new re(this, ee), this.deadClicksAutocapture.startIfEnabled(), this.historyAutocapture = new Le(this), this.historyAutocapture.startIfEnabled(), c.DEBUG = c.DEBUG || this.config.debug, c.DEBUG && j.info("Starting in debug mode", {
      this: this,
      config: e2,
      thisC: B({}, this.config),
      p: o2,
      s: a2
    }), this.bs(), void 0 !== (null == (n2 = e2.bootstrap) ? void 0 : n2.distinctID)) {
      var l2, u2, h2 = this.config.get_device_id(Ni()), d2 = null != (l2 = e2.bootstrap) && l2.isIdentifiedID ? h2 : e2.bootstrap.distinctID;
      this.persistence.set_property(At, null != (u2 = e2.bootstrap) && u2.isIdentifiedID ? "identified" : "anonymous"), this.register({
        distinct_id: e2.bootstrap.distinctID,
        $device_id: d2
      });
    }
    if (this.ws()) {
      var v2, f2, p2 = Object.keys((null == (v2 = e2.bootstrap) ? void 0 : v2.featureFlags) || {}).filter((t2) => {
        var i3;
        return !(null == (i3 = e2.bootstrap) || null == (i3 = i3.featureFlags) || !i3[t2]);
      }).reduce((t2, i3) => {
        var r3;
        return t2[i3] = (null == (r3 = e2.bootstrap) || null == (r3 = r3.featureFlags) ? void 0 : r3[i3]) || false, t2;
      }, {}), _2 = Object.keys((null == (f2 = e2.bootstrap) ? void 0 : f2.featureFlagPayloads) || {}).filter((t2) => p2[t2]).reduce((t2, i3) => {
        var r3, s3;
        null != (r3 = e2.bootstrap) && null != (r3 = r3.featureFlagPayloads) && r3[i3] && (t2[i3] = null == (s3 = e2.bootstrap) || null == (s3 = s3.featureFlagPayloads) ? void 0 : s3[i3]);
        return t2;
      }, {});
      this.featureFlags.receivedFeatureFlags({
        featureFlags: p2,
        featureFlagPayloads: _2
      });
    }
    if (this.config.__preview_experimental_cookieless_mode) this.register_once({
      distinct_id: Bt,
      $device_id: null
    }, "");
    else if (!this.get_distinct_id()) {
      var m2 = this.config.get_device_id(Ni());
      this.register_once({
        distinct_id: m2,
        $device_id: m2
      }, ""), this.persistence.set_property(At, "anonymous");
    }
    return st(t, "onpagehide" in self ? "pagehide" : "unload", this._handle_unload.bind(this), {
      passive: false
    }), this.toolbar.maybeLoadToolbar(), e2.segment ? cs(this, () => this.ys()) : this.ys(), E(this.config._onCapture) && this.config._onCapture !== Ho && (j.warn("onCapture is deprecated. Please use `before_send` instead"), this.on("eventCaptured", (t2) => this.config._onCapture(t2.event, t2))), this;
  }
  be(t2) {
    var i2, e2, r2, s2, n2, a2, l2, u2;
    if (!o || !o.body) return j.info("document not ready yet, trying again in 500 milliseconds..."), void setTimeout(() => {
      this.be(t2);
    }, 500);
    this.compression = void 0, t2.supportedCompression && !this.config.disable_compression && (this.compression = m(t2.supportedCompression, g.GZipJS) ? g.GZipJS : m(t2.supportedCompression, g.Base64) ? g.Base64 : void 0), null != (i2 = t2.analytics) && i2.endpoint && (this.analyticsDefaultEndpoint = t2.analytics.endpoint), this.set_config({
      person_profiles: this.vs ? this.vs : "identified_only"
    }), null == (e2 = this.siteApps) || e2.onRemoteConfig(t2), null == (r2 = this.sessionRecording) || r2.onRemoteConfig(t2), null == (s2 = this.autocapture) || s2.onRemoteConfig(t2), null == (n2 = this.heatmaps) || n2.onRemoteConfig(t2), this.surveys.onRemoteConfig(t2), null == (a2 = this.webVitalsAutocapture) || a2.onRemoteConfig(t2), null == (l2 = this.exceptionObserver) || l2.onRemoteConfig(t2), this.exceptions.onRemoteConfig(t2), null == (u2 = this.deadClicksAutocapture) || u2.onRemoteConfig(t2);
  }
  ys() {
    try {
      this.config.loaded(this);
    } catch (t2) {
      j.critical("`loaded` function failed", t2);
    }
    this.Ss(), this.config.capture_pageview && setTimeout(() => {
      this.consent.isOptedIn() && this.$s();
    }, 1), new So(this).load(), this.featureFlags.decide();
  }
  Ss() {
    var t2;
    this.has_opted_out_capturing() || this.config.request_batching && (null == (t2 = this.ps) || t2.enable());
  }
  _dom_loaded() {
    this.has_opted_out_capturing() || G(this.__request_queue, (t2) => this.gs(t2)), this.__request_queue = [], this.Ss();
  }
  _handle_unload() {
    var t2, i2;
    this.config.request_batching ? (this.ks() && this.capture("$pageleave"), null == (t2 = this.ps) || t2.unload(), null == (i2 = this._s) || i2.unload()) : this.ks() && this.capture("$pageleave", null, {
      transport: "sendBeacon"
    });
  }
  me(t2) {
    this.__loaded && (Go ? this.__request_queue.push(t2) : this.rateLimiter.isServerRateLimited(t2.batchKey) || (t2.transport = t2.transport || this.config.api_transport, t2.url = Fs(t2.url, {
      ip: this.config.ip ? 1 : 0
    }), t2.headers = B({}, this.config.request_headers), t2.compression = "best-available" === t2.compression ? this.compression : t2.compression, t2.fetchOptions = t2.fetchOptions || this.config.fetch_options, ((t3) => {
      var i2, e2, r2, s2 = B({}, t3);
      s2.timeout = s2.timeout || 6e4, s2.url = Fs(s2.url, {
        _: (/* @__PURE__ */ new Date()).getTime().toString(),
        ver: c.LIB_VERSION,
        compression: s2.compression
      });
      var n2 = null !== (i2 = s2.transport) && void 0 !== i2 ? i2 : "fetch", o2 = null !== (e2 = null == (r2 = rt(Ls, (t4) => t4.transport === n2)) ? void 0 : r2.method) && void 0 !== e2 ? e2 : Ls[0].method;
      if (!o2) throw new Error("No available transport method");
      o2(s2);
    })(B({}, t2, {
      callback: (i2) => {
        var e2, r2;
        (this.rateLimiter.checkForLimiting(i2), i2.statusCode >= 400) && (null == (e2 = (r2 = this.config).on_request_error) || e2.call(r2, i2));
        null == t2.callback || t2.callback(i2);
      }
    }))));
  }
  gs(t2) {
    this._s ? this._s.retriableRequest(t2) : this.me(t2);
  }
  _execute_array(t2) {
    var i2, e2 = [], r2 = [], s2 = [];
    G(t2, (t3) => {
      t3 && (i2 = t3[0], x(i2) ? s2.push(t3) : E(t3) ? t3.call(this) : x(t3) && "alias" === i2 ? e2.push(t3) : x(t3) && -1 !== i2.indexOf("capture") && E(this[i2]) ? s2.push(t3) : r2.push(t3));
    });
    var n2 = function(t3, i3) {
      G(t3, function(t4) {
        if (x(t4[0])) {
          var e3 = i3;
          J(t4, function(t5) {
            e3 = e3[t5[0]].apply(e3, t5.slice(1));
          });
        } else this[t4[0]].apply(this, t4.slice(1));
      }, i3);
    };
    n2(e2, this), n2(r2, this), n2(s2, this);
  }
  ws() {
    var t2, i2;
    return (null == (t2 = this.config.bootstrap) ? void 0 : t2.featureFlags) && Object.keys(null == (i2 = this.config.bootstrap) ? void 0 : i2.featureFlags).length > 0 || false;
  }
  push(t2) {
    this._execute_array([t2]);
  }
  capture(t2, i2, e2) {
    var r2;
    if (this.__loaded && this.persistence && this.sessionPersistence && this.ps) {
      if (!this.consent.isOptedOut()) if (!R(t2) && T(t2)) {
        if (this.config.opt_out_useragent_filter || !this._is_bot()) {
          var s2 = null != e2 && e2.skip_client_rate_limiting ? void 0 : this.rateLimiter.clientRateLimitContext();
          if (null == s2 || !s2.isRateLimited) {
            null != i2 && i2.$current_url && !T(null == i2 ? void 0 : i2.$current_url) && (j.error("Invalid `$current_url` property provided to `posthog.capture`. Input must be a string. Ignoring provided value."), null == i2 || delete i2.$current_url), this.sessionPersistence.update_search_keyword(), this.config.save_campaign_params && this.sessionPersistence.update_campaign_params(), this.config.save_referrer && this.sessionPersistence.update_referrer_info(), (this.config.save_campaign_params || this.config.save_referrer) && this.persistence.set_initial_person_info();
            var n2 = /* @__PURE__ */ new Date(), o2 = (null == e2 ? void 0 : e2.timestamp) || n2, a2 = Ni(), l2 = {
              uuid: a2,
              event: t2,
              properties: this.calculateEventProperties(t2, i2 || {}, o2, a2)
            };
            s2 && (l2.properties.$lib_rate_limit_remaining_tokens = s2.remainingTokens), (null == e2 ? void 0 : e2.$set) && (l2.$set = null == e2 ? void 0 : e2.$set);
            var u2 = this.xs(null == e2 ? void 0 : e2.$set_once);
            u2 && (l2.$set_once = u2), (l2 = tt(l2, null != e2 && e2._noTruncate ? null : this.config.properties_string_max_length)).timestamp = o2, R(null == e2 ? void 0 : e2.timestamp) || (l2.properties.$event_time_override_provided = true, l2.properties.$event_time_override_system_time = n2);
            var h2 = B({}, l2.properties.$set, l2.$set);
            if (P(h2) || this.setPersonPropertiesForFlags(h2), !O(this.config.before_send)) {
              var d2 = this.Es(l2);
              if (!d2) return;
              l2 = d2;
            }
            this.us.emit("eventCaptured", l2);
            var v2 = {
              method: "POST",
              url: null !== (r2 = null == e2 ? void 0 : e2._url) && void 0 !== r2 ? r2 : this.requestRouter.endpointFor("api", this.analyticsDefaultEndpoint),
              data: l2,
              compression: "best-available",
              batchKey: null == e2 ? void 0 : e2._batchKey
            };
            return !this.config.request_batching || e2 && (null == e2 || !e2._batchKey) || null != e2 && e2.send_instantly ? this.gs(v2) : this.ps.enqueue(v2), l2;
          }
          j.critical("This capture call is ignored due to client rate limiting.");
        }
      } else j.error("No event name provided to posthog.capture");
    } else j.uninitializedWarning("posthog.capture");
  }
  Ne(t2) {
    return this.on("eventCaptured", (i2) => t2(i2.event, i2));
  }
  calculateEventProperties(t2, i2, e2, r2, s2) {
    if (e2 = e2 || /* @__PURE__ */ new Date(), !this.persistence || !this.sessionPersistence) return i2;
    var n2 = s2 ? void 0 : this.persistence.remove_event_timer(t2), a2 = B({}, i2);
    if (a2.token = this.config.token, a2.$config_defaults = this.config.defaults, this.config.__preview_experimental_cookieless_mode && (a2.$cookieless_mode = true), "$snapshot" === t2) {
      var l2 = B({}, this.persistence.properties(), this.sessionPersistence.properties());
      return a2.distinct_id = l2.distinct_id, (!T(a2.distinct_id) && !F(a2.distinct_id) || M(a2.distinct_id)) && j.error("Invalid distinct_id for replay event. This indicates a bug in your implementation"), a2;
    }
    var u2, h2 = to(this.config.mask_personal_data_properties, this.config.custom_personal_data_properties);
    if (this.sessionManager) {
      var {
        sessionId: v2,
        windowId: c2
      } = this.sessionManager.checkAndGetSessionAndWindowId(s2, e2.getTime());
      a2.$session_id = v2, a2.$window_id = c2;
    }
    this.sessionPropsManager && V(a2, this.sessionPropsManager.getSessionProps());
    try {
      var f2;
      this.sessionRecording && V(a2, this.sessionRecording.sdkDebugProperties), a2.$sdk_debug_retry_queue_size = null == (f2 = this._s) ? void 0 : f2.length;
    } catch (t3) {
      a2.$sdk_debug_error_capturing_properties = String(t3);
    }
    if (this.requestRouter.region === No.CUSTOM && (a2.$lib_custom_api_host = this.config.api_host), u2 = "$pageview" !== t2 || s2 ? "$pageleave" !== t2 || s2 ? this.pageViewManager.doEvent() : this.pageViewManager.doPageLeave(e2) : this.pageViewManager.doPageView(e2, r2), a2 = V(a2, u2), "$pageview" === t2 && o && (a2.title = o.title), !R(n2)) {
      var p2 = e2.getTime() - n2;
      a2.$duration = parseFloat((p2 / 1e3).toFixed(3));
    }
    d && this.config.opt_out_useragent_filter && (a2.$browser_type = this._is_bot() ? "bot" : "browser"), (a2 = V({}, h2, this.persistence.properties(), this.sessionPersistence.properties(), a2)).$is_identified = this._isIdentified(), x(this.config.property_denylist) ? J(this.config.property_denylist, function(t3) {
      delete a2[t3];
    }) : j.error("Invalid value for property_denylist config: " + this.config.property_denylist + " or property_blacklist config: " + this.config.property_blacklist);
    var g2 = this.config.sanitize_properties;
    g2 && (j.error("sanitize_properties is deprecated. Use before_send instead"), a2 = g2(a2, t2));
    var _2 = this.Is();
    return a2.$process_person_profile = _2, _2 && !s2 && this.Ps("_calculate_event_properties"), a2;
  }
  xs(t2) {
    var i2;
    if (!this.persistence || !this.Is()) return t2;
    if (this.ls) return t2;
    var e2 = this.persistence.get_initial_props(), r2 = null == (i2 = this.sessionPropsManager) ? void 0 : i2.getSetOnceProps(), s2 = V({}, e2, r2 || {}, t2 || {}), n2 = this.config.sanitize_properties;
    return n2 && (j.error("sanitize_properties is deprecated. Use before_send instead"), s2 = n2(s2, "$set_once")), this.ls = true, P(s2) ? void 0 : s2;
  }
  register(t2, i2) {
    var e2;
    null == (e2 = this.persistence) || e2.register(t2, i2);
  }
  register_once(t2, i2, e2) {
    var r2;
    null == (r2 = this.persistence) || r2.register_once(t2, i2, e2);
  }
  register_for_session(t2) {
    var i2;
    null == (i2 = this.sessionPersistence) || i2.register(t2);
  }
  unregister(t2) {
    var i2;
    null == (i2 = this.persistence) || i2.unregister(t2);
  }
  unregister_for_session(t2) {
    var i2;
    null == (i2 = this.sessionPersistence) || i2.unregister(t2);
  }
  Rs(t2, i2) {
    this.register({
      [t2]: i2
    });
  }
  getFeatureFlag(t2, i2) {
    return this.featureFlags.getFeatureFlag(t2, i2);
  }
  getFeatureFlagPayload(t2) {
    var i2 = this.featureFlags.getFeatureFlagPayload(t2);
    try {
      return JSON.parse(i2);
    } catch (t3) {
      return i2;
    }
  }
  isFeatureEnabled(t2, i2) {
    return this.featureFlags.isFeatureEnabled(t2, i2);
  }
  reloadFeatureFlags() {
    this.featureFlags.reloadFeatureFlags();
  }
  updateEarlyAccessFeatureEnrollment(t2, i2) {
    this.featureFlags.updateEarlyAccessFeatureEnrollment(t2, i2);
  }
  getEarlyAccessFeatures(t2, i2, e2) {
    return void 0 === i2 && (i2 = false), this.featureFlags.getEarlyAccessFeatures(t2, i2, e2);
  }
  on(t2, i2) {
    return this.us.on(t2, i2);
  }
  onFeatureFlags(t2) {
    return this.featureFlags.onFeatureFlags(t2);
  }
  onSurveysLoaded(t2) {
    return this.surveys.onSurveysLoaded(t2);
  }
  onSessionId(t2) {
    var i2, e2;
    return null !== (i2 = null == (e2 = this.sessionManager) ? void 0 : e2.onSessionId(t2)) && void 0 !== i2 ? i2 : () => {
    };
  }
  getSurveys(t2, i2) {
    void 0 === i2 && (i2 = false), this.surveys.getSurveys(t2, i2);
  }
  getActiveMatchingSurveys(t2, i2) {
    void 0 === i2 && (i2 = false), this.surveys.getActiveMatchingSurveys(t2, i2);
  }
  renderSurvey(t2, i2) {
    this.surveys.renderSurvey(t2, i2);
  }
  canRenderSurvey(t2) {
    return this.surveys.canRenderSurvey(t2);
  }
  canRenderSurveyAsync(t2, i2) {
    return void 0 === i2 && (i2 = false), this.surveys.canRenderSurveyAsync(t2, i2);
  }
  identify(t2, i2, e2) {
    if (!this.__loaded || !this.persistence) return j.uninitializedWarning("posthog.identify");
    if (F(t2) && (t2 = t2.toString(), j.warn("The first argument to posthog.identify was a number, but it should be a string. It has been converted to a string.")), t2) {
      if (["distinct_id", "distinctid"].includes(t2.toLowerCase())) j.critical('The string "' + t2 + '" was set in posthog.identify which indicates an error. This ID should be unique to the user and not a hardcoded string.');
      else if (this.Ps("posthog.identify")) {
        var r2 = this.get_distinct_id();
        if (this.register({
          $user_id: t2
        }), !this.get_property("$device_id")) {
          var s2 = r2;
          this.register_once({
            $had_persisted_distinct_id: true,
            $device_id: s2
          }, "");
        }
        t2 !== r2 && t2 !== this.get_property(ot) && (this.unregister(ot), this.register({
          distinct_id: t2
        }));
        var n2 = "anonymous" === (this.persistence.get_property(At) || "anonymous");
        t2 !== r2 && n2 ? (this.persistence.set_property(At, "identified"), this.setPersonPropertiesForFlags(B({}, e2 || {}, i2 || {}), false), this.capture("$identify", {
          distinct_id: t2,
          $anon_distinct_id: r2
        }, {
          $set: i2 || {},
          $set_once: e2 || {}
        }), this.cs = js(t2, i2, e2), this.featureFlags.setAnonymousDistinctId(r2)) : (i2 || e2) && this.setPersonProperties(i2, e2), t2 !== r2 && (this.reloadFeatureFlags(), this.unregister(Ft));
      }
    } else j.error("Unique user id has not been set in posthog.identify");
  }
  setPersonProperties(t2, i2) {
    if ((t2 || i2) && this.Ps("posthog.setPersonProperties")) {
      var e2 = js(this.get_distinct_id(), t2, i2);
      this.cs !== e2 ? (this.setPersonPropertiesForFlags(B({}, i2 || {}, t2 || {})), this.capture("$set", {
        $set: t2 || {},
        $set_once: i2 || {}
      }), this.cs = e2) : j.info("A duplicate setPersonProperties call was made with the same properties. It has been ignored.");
    }
  }
  group(t2, i2, e2) {
    if (t2 && i2) {
      if (this.Ps("posthog.group")) {
        var r2 = this.getGroups();
        r2[t2] !== i2 && this.resetGroupPropertiesForFlags(t2), this.register({
          $groups: B({}, r2, {
            [t2]: i2
          })
        }), e2 && (this.capture("$groupidentify", {
          $group_type: t2,
          $group_key: i2,
          $group_set: e2
        }), this.setGroupPropertiesForFlags({
          [t2]: e2
        })), r2[t2] === i2 || e2 || this.reloadFeatureFlags();
      }
    } else j.error("posthog.group requires a group type and group key");
  }
  resetGroups() {
    this.register({
      $groups: {}
    }), this.resetGroupPropertiesForFlags(), this.reloadFeatureFlags();
  }
  setPersonPropertiesForFlags(t2, i2) {
    void 0 === i2 && (i2 = true), this.featureFlags.setPersonPropertiesForFlags(t2, i2);
  }
  resetPersonPropertiesForFlags() {
    this.featureFlags.resetPersonPropertiesForFlags();
  }
  setGroupPropertiesForFlags(t2, i2) {
    void 0 === i2 && (i2 = true), this.Ps("posthog.setGroupPropertiesForFlags") && this.featureFlags.setGroupPropertiesForFlags(t2, i2);
  }
  resetGroupPropertiesForFlags(t2) {
    this.featureFlags.resetGroupPropertiesForFlags(t2);
  }
  reset(t2) {
    var i2, e2, r2, s2;
    if (j.info("reset"), !this.__loaded) return j.uninitializedWarning("posthog.reset");
    var n2 = this.get_property("$device_id");
    if (this.consent.reset(), null == (i2 = this.persistence) || i2.clear(), null == (e2 = this.sessionPersistence) || e2.clear(), this.surveys.reset(), null == (r2 = this.persistence) || r2.set_property(At, "anonymous"), null == (s2 = this.sessionManager) || s2.resetSessionId(), this.cs = null, this.config.__preview_experimental_cookieless_mode) this.register_once({
      distinct_id: Bt,
      $device_id: null
    }, "");
    else {
      var o2 = this.config.get_device_id(Ni());
      this.register_once({
        distinct_id: o2,
        $device_id: t2 ? o2 : n2
      }, "");
    }
    this.register({
      $last_posthog_reset: (/* @__PURE__ */ new Date()).toISOString()
    }, 1);
  }
  get_distinct_id() {
    return this.get_property("distinct_id");
  }
  getGroups() {
    return this.get_property("$groups") || {};
  }
  get_session_id() {
    var t2, i2;
    return null !== (t2 = null == (i2 = this.sessionManager) ? void 0 : i2.checkAndGetSessionAndWindowId(true).sessionId) && void 0 !== t2 ? t2 : "";
  }
  get_session_replay_url(t2) {
    if (!this.sessionManager) return "";
    var {
      sessionId: i2,
      sessionStartTimestamp: e2
    } = this.sessionManager.checkAndGetSessionAndWindowId(true), r2 = this.requestRouter.endpointFor("ui", "/project/" + this.config.token + "/replay/" + i2);
    if (null != t2 && t2.withTimestamp && e2) {
      var s2, n2 = null !== (s2 = t2.timestampLookBack) && void 0 !== s2 ? s2 : 10;
      if (!e2) return r2;
      r2 += "?t=" + Math.max(Math.floor(((/* @__PURE__ */ new Date()).getTime() - e2) / 1e3) - n2, 0);
    }
    return r2;
  }
  alias(t2, i2) {
    return t2 === this.get_property(nt) ? (j.critical("Attempting to create alias for existing People user - aborting."), -2) : this.Ps("posthog.alias") ? (R(i2) && (i2 = this.get_distinct_id()), t2 !== i2 ? (this.Rs(ot, t2), this.capture("$create_alias", {
      alias: t2,
      distinct_id: i2
    })) : (j.warn("alias matches current distinct_id - skipping api call."), this.identify(t2), -1)) : void 0;
  }
  set_config(t2) {
    var i2, e2, r2, s2, n2 = B({}, this.config);
    I(t2) && (V(this.config, Vo(t2)), null == (i2 = this.persistence) || i2.update_config(this.config, n2), this.sessionPersistence = "sessionStorage" === this.config.persistence || "memory" === this.config.persistence ? this.persistence : new co(B({}, this.config, {
      persistence: "sessionStorage"
    })), Wi.O() && "true" === Wi.A("ph_debug") && (this.config.debug = true), this.config.debug && (c.DEBUG = true, j.info("set_config", JSON.stringify({
      config: t2,
      oldConfig: n2,
      newConfig: B({}, this.config)
    }, null, 2))), null == (e2 = this.sessionRecording) || e2.startIfEnabledOrStop(), null == (r2 = this.autocapture) || r2.startIfEnabled(), null == (s2 = this.heatmaps) || s2.startIfEnabled(), this.surveys.loadIfEnabled(), this.bs());
  }
  startSessionRecording(t2) {
    var i2 = true === t2, e2 = {
      sampling: i2 || !(null == t2 || !t2.sampling),
      linked_flag: i2 || !(null == t2 || !t2.linked_flag),
      url_trigger: i2 || !(null == t2 || !t2.url_trigger),
      event_trigger: i2 || !(null == t2 || !t2.event_trigger)
    };
    if (Object.values(e2).some(Boolean)) {
      var r2, s2, n2, o2, a2;
      if (null == (r2 = this.sessionManager) || r2.checkAndGetSessionAndWindowId(), e2.sampling) null == (s2 = this.sessionRecording) || s2.overrideSampling();
      if (e2.linked_flag) null == (n2 = this.sessionRecording) || n2.overrideLinkedFlag();
      if (e2.url_trigger) null == (o2 = this.sessionRecording) || o2.overrideTrigger("url");
      if (e2.event_trigger) null == (a2 = this.sessionRecording) || a2.overrideTrigger("event");
    }
    this.set_config({
      disable_session_recording: false
    });
  }
  stopSessionRecording() {
    this.set_config({
      disable_session_recording: true
    });
  }
  sessionRecordingStarted() {
    var t2;
    return !(null == (t2 = this.sessionRecording) || !t2.started);
  }
  captureException(t2, i2) {
    var e2 = new Error("PostHog syntheticException");
    this.exceptions.sendExceptionEvent(B({}, Ae(((t3) => t3 instanceof Error)(t2) ? {
      error: t2,
      event: t2.message
    } : {
      event: t2
    }, {
      syntheticException: e2
    }), i2));
  }
  loadToolbar(t2) {
    return this.toolbar.loadToolbar(t2);
  }
  get_property(t2) {
    var i2;
    return null == (i2 = this.persistence) ? void 0 : i2.props[t2];
  }
  getSessionProperty(t2) {
    var i2;
    return null == (i2 = this.sessionPersistence) ? void 0 : i2.props[t2];
  }
  toString() {
    var t2, i2 = null !== (t2 = this.config.name) && void 0 !== t2 ? t2 : Wo;
    return i2 !== Wo && (i2 = Wo + "." + i2), i2;
  }
  _isIdentified() {
    var t2, i2;
    return "identified" === (null == (t2 = this.persistence) ? void 0 : t2.get_property(At)) || "identified" === (null == (i2 = this.sessionPersistence) ? void 0 : i2.get_property(At));
  }
  Is() {
    var t2, i2;
    return !("never" === this.config.person_profiles || "identified_only" === this.config.person_profiles && !this._isIdentified() && P(this.getGroups()) && (null == (t2 = this.persistence) || null == (t2 = t2.props) || !t2[ot]) && (null == (i2 = this.persistence) || null == (i2 = i2.props) || !i2[Ut]));
  }
  ks() {
    return true === this.config.capture_pageleave || "if_capture_pageview" === this.config.capture_pageleave && (true === this.config.capture_pageview || "history_change" === this.config.capture_pageview);
  }
  createPersonProfile() {
    this.Is() || this.Ps("posthog.createPersonProfile") && this.setPersonProperties({}, {});
  }
  Ps(t2) {
    return "never" === this.config.person_profiles ? (j.error(t2 + ' was called, but process_person is set to "never". This call will be ignored.'), false) : (this.Rs(Ut, true), true);
  }
  bs() {
    var t2, i2, e2, r2, s2 = this.consent.isOptedOut(), n2 = this.config.opt_out_persistence_by_default, o2 = this.config.disable_persistence || s2 && !!n2;
    (null == (t2 = this.persistence) ? void 0 : t2.xe) !== o2 && (null == (e2 = this.persistence) || e2.set_disabled(o2));
    (null == (i2 = this.sessionPersistence) ? void 0 : i2.xe) !== o2 && (null == (r2 = this.sessionPersistence) || r2.set_disabled(o2));
  }
  opt_in_capturing(t2) {
    var i2;
    (this.consent.optInOut(true), this.bs(), R(null == t2 ? void 0 : t2.captureEventName) || null != t2 && t2.captureEventName) && this.capture(null !== (i2 = null == t2 ? void 0 : t2.captureEventName) && void 0 !== i2 ? i2 : "$opt_in", null == t2 ? void 0 : t2.captureProperties, {
      send_instantly: true
    });
    this.config.capture_pageview && this.$s();
  }
  opt_out_capturing() {
    this.consent.optInOut(false), this.bs();
  }
  has_opted_in_capturing() {
    return this.consent.isOptedIn();
  }
  has_opted_out_capturing() {
    return this.consent.isOptedOut();
  }
  clear_opt_in_out_capturing() {
    this.consent.reset(), this.bs();
  }
  _is_bot() {
    return n ? Lo(n, this.config.custom_blocked_useragents) : void 0;
  }
  $s() {
    o && ("visible" === o.visibilityState ? this.hs || (this.hs = true, this.capture("$pageview", {
      title: o.title
    }, {
      send_instantly: true
    }), this.ds && (o.removeEventListener("visibilitychange", this.ds), this.ds = null)) : this.ds || (this.ds = this.$s.bind(this), st(o, "visibilitychange", this.ds)));
  }
  debug(i2) {
    false === i2 ? (null == t || t.console.log("You've disabled debug mode."), localStorage && localStorage.removeItem("ph_debug"), this.set_config({
      debug: false
    })) : (null == t || t.console.log("You're now in debug mode. All calls to PostHog will be logged in your console.\nYou can disable this with `posthog.debug(false)`."), localStorage && localStorage.setItem("ph_debug", "true"), this.set_config({
      debug: true
    }));
  }
  Es(t2) {
    if (O(this.config.before_send)) return t2;
    var i2 = x(this.config.before_send) ? this.config.before_send : [this.config.before_send], e2 = t2;
    for (var r2 of i2) {
      if (e2 = r2(e2), O(e2)) {
        var s2 = "Event '" + t2.event + "' was rejected in beforeSend function";
        return L(t2.event) ? j.warn(s2 + ". This can cause unexpected behavior.") : j.info(s2), null;
      }
      e2.properties && !P(e2.properties) || j.warn("Event '" + t2.event + "' has no properties after beforeSend function, this is likely an error.");
    }
    return e2;
  }
  getPageViewId() {
    var t2;
    return null == (t2 = this.pageViewManager.ne) ? void 0 : t2.pageViewId;
  }
  captureTraceFeedback(t2, i2) {
    this.capture("$ai_feedback", {
      $ai_trace_id: String(t2),
      $ai_feedback_text: i2
    });
  }
  captureTraceMetric(t2, i2, e2) {
    this.capture("$ai_metric", {
      $ai_trace_id: String(t2),
      $ai_metric_name: i2,
      $ai_metric_value: String(e2)
    });
  }
}
!(function(t2, i2) {
  for (var e2 = 0; e2 < i2.length; e2++) t2.prototype[i2[e2]] = Q(t2.prototype[i2[e2]]);
})(Yo, ["identify"]);
var Xo;
(function(t2) {
  return t2.Button = "button", t2.Tab = "tab", t2.Selector = "selector", t2;
})({});
(function(t2) {
  return t2.TopLeft = "top_left", t2.TopRight = "top_right", t2.TopCenter = "top_center", t2.MiddleLeft = "middle_left", t2.MiddleRight = "middle_right", t2.MiddleCenter = "middle_center", t2.Left = "left", t2.Center = "center", t2.Right = "right", t2.NextToTrigger = "next_to_trigger", t2;
})({});
(function(t2) {
  return t2.Popover = "popover", t2.API = "api", t2.Widget = "widget", t2;
})({});
(function(t2) {
  return t2.Open = "open", t2.MultipleChoice = "multiple_choice", t2.SingleChoice = "single_choice", t2.Rating = "rating", t2.Link = "link", t2;
})({});
(function(t2) {
  return t2.NextQuestion = "next_question", t2.End = "end", t2.ResponseBased = "response_based", t2.SpecificQuestion = "specific_question", t2;
})({});
(function(t2) {
  return t2.Once = "once", t2.Recurring = "recurring", t2.Always = "always", t2;
})({});
var sa = (Xo = Bo[Wo] = new Yo(), (function() {
  function i2() {
    i2.done || (i2.done = true, Go = false, J(Bo, function(t2) {
      t2._dom_loaded();
    }));
  }
  null != o && o.addEventListener ? "complete" === o.readyState ? i2() : st(o, "DOMContentLoaded", i2, {
    capture: false
  }) : t && j.error("Browser doesn't support `document.addEventListener` so PostHog couldn't be initialized");
})(), Xo);
const IS_LOGGED_IN = "isLoggedIn";
const logOutAction = action(async () => {
  await websiteRequest("/logout", {
    method: "POST"
  });
  throw reload({
    revalidate: [getAuthState.key, getUser.key]
  });
});
var _tmpl$$2 = /* @__PURE__ */ template(`<svg viewBox="0 0 15 15"width=1.2em height=1.2em><path fill=currentColor fill-rule=evenodd d="M3 2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8.5a.5.5 0 0 0-1 0V12H3V3h3.5a.5.5 0 0 0 0-1zm9.854.146a.5.5 0 0 1 .146.351V5.5a.5.5 0 0 1-1 0V3.707L6.854 8.854a.5.5 0 1 1-.708-.708L11.293 3H9.5a.5.5 0 0 1 0-1h3a.5.5 0 0 1 .354.146"clip-rule=evenodd>`);
const IconRadixIconsExternalLink = (props = {}) => (() => {
  var _el$ = getNextElement(_tmpl$$2);
  spread(_el$, props, true, true);
  runHydrationEvents();
  return _el$;
})();
var _tmpl$$1 = /* @__PURE__ */ template(`<div class="size-7 bg-neutral-700 rounded-full animate-pulse mr-1">`), _tmpl$2 = /* @__PURE__ */ template(`<div class="px-2 py-1"><span class="text-sm font-bold">`), _tmpl$3 = /* @__PURE__ */ template(`<a>`), _tmpl$4 = /* @__PURE__ */ template(`<div>`);
const isLoggedIn = () => parse(document.cookie)[IS_LOGGED_IN] === "true";
function HeaderAuthFallback() {
  return getNextElement(_tmpl$$1);
}
function HeaderAuthSection() {
  const user = createAsync(() => getUser());
  createEffect(on$1(() => user(), (user2) => {
    if (user2) sa.identify(user2.id, {
      email: user2.email
    });
    else sa.reset();
  }));
  return createComponent(Suspense, {
    get fallback() {
      return createComponent(HeaderAuthFallback, {});
    },
    get children() {
      return createComponent(Show, {
        get when() {
          if (user()) return user();
          if (!isLoggedIn()) return false;
          return user();
        },
        get fallback() {
          return createComponent(LoginButton, {});
        },
        children: (user2) => createComponent(UserDropdown, {
          get user() {
            return user2();
          },
          get children() {
            return createComponent(DropdownMenuTrigger, {
              "class": "size-7 bg-neutral-600 rounded-full mr-1 flex items-center justify-center",
              get children() {
                return user2().email[0].toUpperCase();
              }
            });
          }
        })
      });
    }
  });
}
function UserDropdown(props) {
  const logOut = useAction(logOutAction);
  return createComponent(DropdownMenu, {
    get children() {
      return [memo(() => props.children), createComponent(DropdownMenuContent, {
        get children() {
          return [(() => {
            var _el$2 = getNextElement(_tmpl$2), _el$3 = _el$2.firstChild;
            insert(_el$3, () => props.user.email);
            return _el$2;
          })(), createComponent(DropdownMenuSeparator, {}), createComponent(DropdownMenuItem, {
            "class": "gap-2",
            closeOnSelect: false,
            as: (props2) => (() => {
              var _el$4 = getNextElement(_tmpl$3);
              spread(_el$4, mergeProps(props2, {
                "href": "/credentials",
                "target": "external"
              }), false, false);
              runHydrationEvents();
              return _el$4;
            })(),
            get children() {
              return ["Credentials ", createComponent(IconRadixIconsExternalLink, {})];
            }
          }), createComponent(DropdownMenuSeparator, {}), createComponent(DropdownMenuItem, {
            onSelect: () => {
              toast.promise(logOut(), {
                loading: "Logging out...",
                success: "Logged out successfully",
                error: "Failed to log out"
              });
            },
            children: "Log Out"
          })];
        }
      })];
    }
  });
}
function LoginButton() {
  const [mode, setMode] = createSignal("login");
  const [open, setOpen] = createSignal(false);
  function onLogin(userId) {
    setOpen(false);
    toast.success("You are now logged in!");
    sa.identify(userId);
  }
  const [search, setSearch] = useSearchParams();
  onMount(() => {
    if (search.promptLogin) {
      if (!isLoggedIn()) setOpen(true);
      setSearch({
        promptLogin: null
      }, {
        replace: true
      });
    }
  });
  return createComponent(Dialog, {
    get open() {
      return open();
    },
    onOpenChange: setOpen,
    get children() {
      return [createComponent(DialogTrigger, {
        as: (props) => createComponent(Button, mergeProps(props, {
          size: "sm"
        })),
        children: "Login"
      }), createComponent(DialogContent, {
        "class": "p-8",
        get children() {
          var _el$5 = getNextElement(_tmpl$4);
          _el$5.$$keyup = (e2) => e2.stopPropagation();
          _el$5.$$keydown = (e2) => e2.stopPropagation();
          insert(_el$5, createComponent(Show, {
            keyed: true,
            get when() {
              return mode() === "login";
            },
            get fallback() {
              return (() => {
                var _el$6 = getNextElement(_tmpl$4);
                insert(_el$6, createComponent(SignUpForm, {
                  onLogin: () => setMode("login"),
                  onSignup: onLogin
                }));
                return _el$6;
              })();
            },
            get children() {
              return createComponent(LoginForm, {
                onSignup: () => setMode("signup"),
                onLogin
              });
            }
          }));
          runHydrationEvents();
          return _el$5;
        }
      })];
    }
  });
}
delegateEvents(["keydown", "keyup"]);
const HeaderAuthSection$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  HeaderAuthFallback,
  HeaderAuthSection,
  UserDropdown
}, Symbol.toStringTag, { value: "Module" }));
var _tmpl$ = /* @__PURE__ */ template(`<h1 class="text-2xl font-black mx-1"><a href=/>MacroGraph`);
function Logo() {
  return getNextElement(_tmpl$);
}
export {
  HeaderAuthFallback as H,
  Logo as L,
  HeaderAuthSection$1 as a
};
