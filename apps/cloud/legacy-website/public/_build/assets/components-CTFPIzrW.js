import { g as getNextElement, t as template, s as spread, b as runHydrationEvents } from "./web-Dl2sEcME.js";
import { m as mergeProps, i as splitProps, a as createMemo } from "./solid-COykZtSy.js";
import { u as useResolvedPath, h as useHref, i as useLocation, j as normalizePath, l as useNavigate } from "./routing-KR3q6KJw.js";
var _tmpl$ = /* @__PURE__ */ template(`<a>`);
function A(props) {
  props = mergeProps({
    inactiveClass: "inactive",
    activeClass: "active"
  }, props);
  const [, rest] = splitProps(props, ["href", "state", "class", "activeClass", "inactiveClass", "end"]);
  const to = useResolvedPath(() => props.href);
  const href = useHref(to);
  const location = useLocation();
  const isActive = createMemo(() => {
    const to_ = to();
    if (to_ === void 0) return [false, false];
    const path = normalizePath(to_.split(/[?#]/, 1)[0]).toLowerCase();
    const loc = decodeURI(normalizePath(location.pathname).toLowerCase());
    return [props.end ? path === loc : loc.startsWith(path + "/") || loc === path, path === loc];
  });
  return (() => {
    var _el$ = getNextElement(_tmpl$);
    spread(_el$, mergeProps(rest, {
      get href() {
        return href() || props.href;
      },
      get state() {
        return JSON.stringify(props.state);
      },
      get classList() {
        return {
          ...props.class && {
            [props.class]: true
          },
          [props.inactiveClass]: !isActive()[0],
          [props.activeClass]: isActive()[0],
          ...rest.classList
        };
      },
      "link": "",
      get ["aria-current"]() {
        return isActive()[1] ? "page" : void 0;
      }
    }), false, false);
    runHydrationEvents();
    return _el$;
  })();
}
function Navigate(props) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    href,
    state
  } = props;
  const path = typeof href === "function" ? href({
    navigate,
    location
  }) : href;
  navigate(path, {
    replace: true,
    state
  });
  return null;
}
export {
  A,
  Navigate as N
};
