import { f as onCleanup } from "./solid-COykZtSy.js";
var EQUALS_FALSE_OPTIONS = {
  equals: false
};
function isObject(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}
var isNonNullable = (i) => i != null;
var filterNonNullable = (arr) => arr.filter(isNonNullable);
function chain(callbacks) {
  return (...args) => {
    for (const callback of callbacks) callback && callback(...args);
  };
}
var access = (v) => typeof v === "function" && !v.length ? v() : v;
var asArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
function accessWith(valueOrFn, ...args) {
  return typeof valueOrFn === "function" ? valueOrFn(...args) : valueOrFn;
}
var entries = Object.entries;
var tryOnCleanup = onCleanup;
var createCallbackStack = () => {
  let stack = [];
  const clear = () => stack = [];
  return {
    push: (...callbacks) => stack.push(...callbacks),
    execute(arg0, arg1, arg2, arg3) {
      stack.forEach((cb) => cb(arg0, arg1, arg2, arg3));
      clear();
    },
    clear
  };
};
function handleDiffArray(current, prev, handleAdded, handleRemoved) {
  const currLength = current.length;
  const prevLength = prev.length;
  let i = 0;
  if (!prevLength) {
    for (; i < currLength; i++) handleAdded(current[i]);
    return;
  }
  if (!currLength) {
    for (; i < prevLength; i++) handleRemoved(prev[i]);
    return;
  }
  for (; i < prevLength; i++) {
    if (prev[i] !== current[i]) break;
  }
  let prevEl;
  let currEl;
  prev = prev.slice(i);
  current = current.slice(i);
  for (prevEl of prev) {
    if (!current.includes(prevEl)) handleRemoved(prevEl);
  }
  for (currEl of current) {
    if (!prev.includes(currEl)) handleAdded(currEl);
  }
}
export {
  EQUALS_FALSE_OPTIONS as E,
  accessWith as a,
  asArray as b,
  chain as c,
  access as d,
  entries as e,
  filterNonNullable as f,
  createCallbackStack as g,
  handleDiffArray as h,
  isObject as i,
  tryOnCleanup as t
};
