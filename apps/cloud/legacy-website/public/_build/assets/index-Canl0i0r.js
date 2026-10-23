import { t as createEffect, j as createRenderEffect, f as onCleanup } from "./solid-COykZtSy.js";
import { b as asArray, d as access, t as tryOnCleanup, e as entries, g as createCallbackStack } from "./R5675YMU-C6EXqLl_.js";
function makeEventListener(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return tryOnCleanup(target.removeEventListener.bind(target, type, handler, options));
}
function createEventListener(targets, type, handler, options) {
  const attachListeners = () => {
    asArray(access(targets)).forEach((el) => {
      if (el) asArray(access(type)).forEach((type2) => makeEventListener(el, type2, handler, options));
    });
  };
  if (typeof targets === "function") createEffect(attachListeners);
  else createRenderEffect(attachListeners);
}
function createEventListenerMap(targets, handlersMap, options) {
  for (const [eventName, handler] of entries(handlersMap)) {
    if (handler) createEventListener(targets, eventName, handler, options);
  }
}
function makeEventListenerStack(target, options) {
  const {
    push,
    execute
  } = createCallbackStack();
  return [(type, handler, overwriteOptions) => {
    const clear = makeEventListener(target, type, handler, overwriteOptions ?? options);
    push(clear);
    return clear;
  }, onCleanup(execute)];
}
export {
  createEventListenerMap as a,
  makeEventListenerStack as b,
  createEventListener as c,
  makeEventListener as m
};
