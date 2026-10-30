import { a as createMemo, f as onCleanup, $ as $TRACK, u as untrack, d as createRoot, e as createSignal, w as getListener, A as batch, i as splitProps, t as createEffect, b as createComponent, m as mergeProps, S as Show, p as createContext, r as useContext, q as createUniqueId, o as on, g as getOwner, s as sharedConfig, F as For, j as createRenderEffect, n as Switch, M as Match, c as children, y as runWithOwner, k as onMount, B as createComputed, v as createResource } from "./solid-COykZtSy.js";
import { g as getNextElement, t as template, s as spread, b as runHydrationEvents, m as memo, a as getNextMarker, u as use, i as insert, h as style, c as setAttribute, e as setProperty, P as Portal, k as isServer$1 } from "./web-BrXyZ-Hv.js";
import { d as mergeDefaultProps, P as Polymorphic, W as createTagName, m as mergeRefs, E as access, f as createRegisterId, g as createGenerateId, X as isSameSelection, h as callHandler, Q as visuallyHiddenStyles, z as createSelectableItem, Y as isMac, A as isWebKit, w as composeEventHandlers, F as createListState, U as createSelectableList, p as focusWithoutScrolling, _ as __export, G as PopperArrow, Z as createTypeSelect, B as ButtonRoot, i as createHideOutside, j as src_default, k as createFocusScope, H as Popper, l as DismissableLayer, n as combineStyle, e as createDisclosureState, s as src_default$1, $ as createCollator, a0 as ListKeyboardDelegate, a1 as isFunction, a2 as Selection, o as contains, a3 as MenuSubTrigger, a4 as MenuSubContent, a5 as MenuSub, S as SeparatorRoot, a6 as MenuRadioItem, a7 as MenuRadioGroup, a as MenuPortal, a8 as MenuItemLabel, a9 as MenuItemIndicator, aa as MenuItemDescription, b as MenuItem, ab as MenuIcon, ac as MenuGroupLabel, ad as MenuGroup, ae as MenuCheckboxItem, u as useLocale, af as MenuRoot, ag as useMenuRootContext, ah as useMenuContext, ai as MenuContent } from "./ZUHR2BAH-DeUuezxO.js";
import { i as isObject, a as accessWith, f as filterNonNullable, b as asArray, d as access$1, h as handleDiffArray, E as EQUALS_FALSE_OPTIONS } from "./R5675YMU-C6EXqLl_.js";
import { m as makeEventListener, b as makeEventListenerStack } from "./index-Canl0i0r.js";
import { c as createStore, u as unwrap, r as reconcile } from "./store-12zX8qse.js";
var FALLBACK = Symbol("fallback");
function dispose(list) {
  for (const o of list) o.dispose();
}
function keyArray(items, keyFn, mapFn, options = {}) {
  const prev = /* @__PURE__ */ new Map();
  onCleanup(() => dispose(prev.values()));
  return () => {
    const list = items() || [];
    list[$TRACK];
    return untrack(() => {
      if (!list.length) {
        dispose(prev.values());
        prev.clear();
        if (!options.fallback) return [];
        const fb2 = createRoot((dispose2) => {
          prev.set(FALLBACK, {
            dispose: dispose2
          });
          return options.fallback();
        });
        return [fb2];
      }
      const result = new Array(list.length);
      const fb = prev.get(FALLBACK);
      if (!prev.size || fb) {
        fb?.dispose();
        prev.delete(FALLBACK);
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          const key = keyFn(item, i);
          addNewItem(result, item, i, key);
        }
        return result;
      }
      const prevKeys = new Set(prev.keys());
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const key = keyFn(item, i);
        prevKeys.delete(key);
        const lookup = prev.get(key);
        if (lookup) {
          result[i] = lookup.mapped;
          lookup.setIndex?.(i);
          lookup.setItem(() => item);
        } else addNewItem(result, item, i, key);
      }
      for (const key of prevKeys) {
        prev.get(key)?.dispose();
        prev.delete(key);
      }
      return result;
    });
  };
  function addNewItem(list, item, i, key) {
    createRoot((dispose2) => {
      const [getItem, setItem] = createSignal(item);
      const save = {
        setItem,
        dispose: dispose2
      };
      if (mapFn.length > 1) {
        const [index, setIndex] = createSignal(i);
        save.setIndex = setIndex;
        save.mapped = mapFn(getItem, index);
      } else save.mapped = mapFn(getItem);
      prev.set(key, save);
      list[i] = save.mapped;
    });
  }
}
function Key(props) {
  const {
    by
  } = props;
  return createMemo(keyArray(() => props.each, typeof by === "function" ? by : (v) => v[by], props.children, "fallback" in props ? {
    fallback: () => props.fallback
  } : void 0));
}
var triggerOptions = {
  equals: false
};
var triggerCacheOptions = triggerOptions;
var TriggerCache = class {
  #map;
  constructor(mapConstructor = Map) {
    this.#map = new mapConstructor();
  }
  dirty(key) {
    this.#map.get(key)?.$$();
  }
  dirtyAll() {
    for (const trigger of this.#map.values()) trigger.$$();
  }
  track(key) {
    if (!getListener()) return;
    let trigger = this.#map.get(key);
    if (!trigger) {
      const [$, $$] = createSignal(void 0, triggerCacheOptions);
      this.#map.set(key, trigger = {
        $,
        $$,
        n: 1
      });
    } else trigger.n++;
    onCleanup(() => {
      if (trigger.n-- === 1) queueMicrotask(() => trigger.n === 0 && this.#map.delete(key));
    });
    trigger.$();
  }
};
var $KEYS = Symbol("track-keys");
var ReactiveMap = class extends Map {
  #keyTriggers = new TriggerCache();
  #valueTriggers = new TriggerCache();
  constructor(initial) {
    super();
    if (initial) for (const v of initial) super.set(v[0], v[1]);
  }
  // reads
  has(key) {
    this.#keyTriggers.track(key);
    return super.has(key);
  }
  get(key) {
    this.#valueTriggers.track(key);
    return super.get(key);
  }
  get size() {
    this.#keyTriggers.track($KEYS);
    return super.size;
  }
  *keys() {
    for (const key of super.keys()) {
      this.#keyTriggers.track(key);
      yield key;
    }
    this.#keyTriggers.track($KEYS);
  }
  *values() {
    for (const [key, v] of super.entries()) {
      this.#valueTriggers.track(key);
      yield v;
    }
    this.#keyTriggers.track($KEYS);
  }
  *entries() {
    for (const entry of super.entries()) {
      this.#valueTriggers.track(entry[0]);
      yield entry;
    }
    this.#keyTriggers.track($KEYS);
  }
  // writes
  set(key, value) {
    batch(() => {
      if (super.has(key)) {
        if (super.get(key) === value) return;
      } else {
        this.#keyTriggers.dirty(key);
        this.#keyTriggers.dirty($KEYS);
      }
      this.#valueTriggers.dirty(key);
      super.set(key, value);
    });
    return this;
  }
  delete(key) {
    const r = super.delete(key);
    if (r) {
      batch(() => {
        this.#keyTriggers.dirty(key);
        this.#keyTriggers.dirty($KEYS);
        this.#valueTriggers.dirty(key);
      });
    }
    return r;
  }
  clear() {
    if (super.size) {
      batch(() => {
        for (const v of super.keys()) {
          this.#keyTriggers.dirty(v);
          this.#valueTriggers.dirty(v);
        }
        super.clear();
        this.#keyTriggers.dirty($KEYS);
      });
    }
  }
  // callback
  forEach(callbackfn) {
    this.#keyTriggers.track($KEYS);
    for (const [key, v] of super.entries()) {
      this.#valueTriggers.track(key);
      callbackfn(v, key, this);
    }
  }
  [Symbol.iterator]() {
    return this.entries();
  }
};
var ReactiveWeakMap = class extends WeakMap {
  #keyTriggers = new TriggerCache(WeakMap);
  #valueTriggers = new TriggerCache(WeakMap);
  constructor(initial) {
    super();
    if (initial) for (const v of initial) super.set(v[0], v[1]);
  }
  has(key) {
    this.#keyTriggers.track(key);
    return super.has(key);
  }
  get(key) {
    this.#valueTriggers.track(key);
    return super.get(key);
  }
  set(key, value) {
    batch(() => {
      if (super.has(key)) {
        if (super.get(key) === value) return;
      } else this.#keyTriggers.dirty(key);
      this.#valueTriggers.dirty(key);
      super.set(key, value);
    });
    return this;
  }
  delete(key) {
    const r = super.delete(key);
    if (r) {
      batch(() => {
        this.#keyTriggers.dirty(key);
        this.#valueTriggers.dirty(key);
      });
    }
    return r;
  }
};
function createStaticStore(init) {
  const copy = {
    ...init
  }, store = {
    ...init
  }, cache2 = {};
  const getValue = (key) => {
    let signal = cache2[key];
    if (!signal) {
      if (!getListener()) return copy[key];
      cache2[key] = signal = createSignal(copy[key], {
        internal: true
      });
      delete copy[key];
    }
    return signal[0]();
  };
  for (const key in init) {
    Object.defineProperty(store, key, {
      get: () => getValue(key),
      enumerable: true
    });
  }
  const setValue = (key, value) => {
    const signal = cache2[key];
    if (signal) return signal[1](value);
    if (key in copy) copy[key] = accessWith(value, [copy[key]]);
  };
  return [store, (a, b) => {
    if (isObject(a)) {
      const entries = untrack(() => Object.entries(accessWith(a, store)));
      batch(() => {
        for (const [key, value] of entries) setValue(key, () => value);
      });
    } else setValue(a, b);
    return store;
  }];
}
var _tmpl$$4 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-linecap=round stroke-linejoin=round stroke-width=2 d="m9 6l6 6l-6 6">`);
const IconTablerChevronRight = (props = {}) => (() => {
  var _el$ = getNextElement(_tmpl$$4);
  spread(_el$, props, true, true);
  runHydrationEvents();
  return _el$;
})();
var w = window;
var n = w.navigator;
var ua = n.userAgent;
var isMobile = /* @__PURE__ */ /Mobi/.test(ua);
!!w.opr && !!w.opr.addons || !!w.opera || /* @__PURE__ */ / OPR\//.test(ua);
!!n.vendor && n.vendor.includes("Apple") && ua && !ua.includes("CriOS") && !ua.includes("FxiOS");
!!n.brave && n.brave.isBrave && n.brave.isBrave.name === "isBrave";
var _tmpl$$3 = /* @__PURE__ */ template(`<svg viewBox="0 0 16 16"width=1.2em height=1.2em><path fill=currentColor d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8L4.646 5.354a.5.5 0 0 1 0-.708">`);
const IconBiX = (props = {}) => (() => {
  var _el$ = getNextElement(_tmpl$$3);
  spread(_el$, props, true, true);
  runHydrationEvents();
  return _el$;
})();
var FORM_CONTROL_PROP_NAMES = ["id", "name", "validationState", "required", "disabled", "readOnly"];
function createFormControl(props) {
  const defaultId = `form-control-${createUniqueId()}`;
  const mergedProps = mergeDefaultProps({
    id: defaultId
  }, props);
  const [labelId, setLabelId] = createSignal();
  const [fieldId, setFieldId] = createSignal();
  const [descriptionId, setDescriptionId] = createSignal();
  const [errorMessageId, setErrorMessageId] = createSignal();
  const getAriaLabelledBy = (fieldId2, fieldAriaLabel, fieldAriaLabelledBy) => {
    const hasAriaLabelledBy = fieldAriaLabelledBy != null || labelId() != null;
    return [
      fieldAriaLabelledBy,
      labelId(),
      // If there is both an aria-label and aria-labelledby, add the field itself has an aria-labelledby
      hasAriaLabelledBy && fieldAriaLabel != null ? fieldId2 : void 0
    ].filter(Boolean).join(" ") || void 0;
  };
  const getAriaDescribedBy = (fieldAriaDescribedBy) => {
    return [
      descriptionId(),
      // Use aria-describedby for error message because aria-errormessage is unsupported using VoiceOver or NVDA.
      // See https://github.com/adobe/react-spectrum/issues/1346#issuecomment-740136268
      errorMessageId(),
      fieldAriaDescribedBy
    ].filter(Boolean).join(" ") || void 0;
  };
  const dataset = createMemo(() => ({
    "data-valid": access(mergedProps.validationState) === "valid" ? "" : void 0,
    "data-invalid": access(mergedProps.validationState) === "invalid" ? "" : void 0,
    "data-required": access(mergedProps.required) ? "" : void 0,
    "data-disabled": access(mergedProps.disabled) ? "" : void 0,
    "data-readonly": access(mergedProps.readOnly) ? "" : void 0
  }));
  const formControlContext = {
    name: () => access(mergedProps.name) ?? access(mergedProps.id),
    dataset,
    validationState: () => access(mergedProps.validationState),
    isRequired: () => access(mergedProps.required),
    isDisabled: () => access(mergedProps.disabled),
    isReadOnly: () => access(mergedProps.readOnly),
    labelId,
    fieldId,
    descriptionId,
    errorMessageId,
    getAriaLabelledBy,
    getAriaDescribedBy,
    generateId: createGenerateId(() => access(mergedProps.id)),
    registerLabel: createRegisterId(setLabelId),
    registerField: createRegisterId(setFieldId),
    registerDescription: createRegisterId(setDescriptionId),
    registerErrorMessage: createRegisterId(setErrorMessageId)
  };
  return {
    formControlContext
  };
}
var FormControlContext = createContext();
function useFormControlContext() {
  const context = useContext(FormControlContext);
  if (context === void 0) {
    throw new Error("[kobalte]: `useFormControlContext` must be used within a `FormControlContext.Provider` component");
  }
  return context;
}
function FormControlDescription(props) {
  const context = useFormControlContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("description")
  }, props);
  createEffect(() => onCleanup(context.registerDescription(mergedProps.id)));
  return createComponent(Polymorphic, mergeProps({
    as: "div"
  }, () => context.dataset(), mergedProps));
}
function FormControlErrorMessage(props) {
  const context = useFormControlContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("error-message")
  }, props);
  const [local, others] = splitProps(mergedProps, ["forceMount"]);
  const isInvalid = () => context.validationState() === "invalid";
  createEffect(() => {
    if (!isInvalid()) {
      return;
    }
    onCleanup(context.registerErrorMessage(others.id));
  });
  return createComponent(Show, {
    get when() {
      return local.forceMount || isInvalid();
    },
    get children() {
      return createComponent(Polymorphic, mergeProps({
        as: "div"
      }, () => context.dataset(), others));
    }
  });
}
function FormControlLabel(props) {
  let ref;
  const context = useFormControlContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("label")
  }, props);
  const [local, others] = splitProps(mergedProps, ["ref"]);
  const tagName = createTagName(() => ref, () => "label");
  createEffect(() => onCleanup(context.registerLabel(others.id)));
  return createComponent(Polymorphic, mergeProps({
    as: "label",
    ref(r$) {
      var _ref$ = mergeRefs((el) => ref = el, local.ref);
      typeof _ref$ === "function" && _ref$(r$);
    },
    get ["for"]() {
      return memo(() => tagName() === "label")() ? context.fieldId() : void 0;
    }
  }, () => context.dataset(), others));
}
var FORM_CONTROL_FIELD_PROP_NAMES = ["id", "aria-label", "aria-labelledby", "aria-describedby"];
function createFormControlField(props) {
  const context = useFormControlContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("field")
  }, props);
  createEffect(() => onCleanup(context.registerField(access(mergedProps.id))));
  return {
    fieldProps: {
      id: () => access(mergedProps.id),
      ariaLabel: () => access(mergedProps["aria-label"]),
      ariaLabelledBy: () => context.getAriaLabelledBy(access(mergedProps.id), access(mergedProps["aria-label"]), access(mergedProps["aria-labelledby"])),
      ariaDescribedBy: () => context.getAriaDescribedBy(access(mergedProps["aria-describedby"]))
    }
  };
}
function createFormResetListener(element, handler) {
  createEffect(on(element, (element2) => {
    if (element2 == null) {
      return;
    }
    const form = getClosestForm(element2);
    if (form == null) {
      return;
    }
    form.addEventListener("reset", handler, {
      passive: true
    });
    onCleanup(() => {
      form.removeEventListener("reset", handler);
    });
  }));
}
function getClosestForm(element) {
  return isFormElement(element) ? element.form : element.closest("form");
}
function isFormElement(element) {
  return element.matches("textarea, input, select, button");
}
function createSingletonRoot(factory, detachedOwner = getOwner()) {
  let listeners = 0, value, disposeRoot;
  return () => {
    listeners++;
    onCleanup(() => {
      listeners--;
      queueMicrotask(() => {
        if (!listeners && disposeRoot) {
          disposeRoot();
          disposeRoot = value = void 0;
        }
      });
    });
    if (!disposeRoot) {
      createRoot((dispose2) => value = factory(disposeRoot = dispose2), detachedOwner);
    }
    return value;
  };
}
function createHydratableSingletonRoot(factory) {
  const owner = getOwner();
  const singleton = createSingletonRoot(factory, owner);
  return () => sharedConfig.context ? createRoot(factory, owner) : singleton();
}
function makeResizeObserver(callback, options) {
  const observer = new ResizeObserver(callback);
  onCleanup(observer.disconnect.bind(observer));
  return {
    observe: (ref) => observer.observe(ref, options),
    unobserve: observer.unobserve.bind(observer)
  };
}
function createResizeObserver(targets, onResize, options) {
  const previousMap = /* @__PURE__ */ new WeakMap(), {
    observe,
    unobserve
  } = makeResizeObserver((entries) => {
    for (const entry of entries) {
      const {
        contentRect,
        target
      } = entry, width = Math.round(contentRect.width), height = Math.round(contentRect.height), previous = previousMap.get(target);
      if (!previous || previous.width !== width || previous.height !== height) {
        onResize(contentRect, target, entry);
        previousMap.set(target, {
          width,
          height
        });
      }
    }
  }, options);
  createEffect((prev) => {
    const refs = filterNonNullable(asArray(access$1(targets)));
    handleDiffArray(refs, prev, observe, unobserve);
    return refs;
  }, []);
}
var _tmpl$$2 = /* @__PURE__ */ template(`<option>`), _tmpl$2 = /* @__PURE__ */ template(`<div aria-hidden=true><input type=text style=font-size:16px><select tabindex=-1><option></option><!$><!/>`);
function HiddenSelectBase(props) {
  let ref;
  const [local, others] = splitProps(props, ["ref", "onChange", "collection", "selectionManager", "isOpen", "isMultiple", "isVirtualized", "focusTrigger"]);
  const formControlContext = useFormControlContext();
  const [isInternalChangeEvent, setIsInternalChangeEvent] = createSignal(false);
  const renderOption = (key) => {
    const item = local.collection.getItem(key);
    return createComponent(Show, {
      get when() {
        return item?.type === "item";
      },
      get children() {
        var _el$ = getNextElement(_tmpl$$2);
        setProperty(_el$, "value", key);
        insert(_el$, () => item?.textValue);
        createRenderEffect(() => setProperty(_el$, "selected", local.selectionManager.isSelected(key)));
        return _el$;
      }
    });
  };
  createEffect(on(() => local.selectionManager.selectedKeys(), (keys, prevKeys) => {
    if (prevKeys && isSameSelection(keys, prevKeys)) {
      return;
    }
    setIsInternalChangeEvent(true);
    ref?.dispatchEvent(new Event("input", {
      bubbles: true,
      cancelable: true
    }));
    ref?.dispatchEvent(new Event("change", {
      bubbles: true,
      cancelable: true
    }));
  }, {
    defer: true
  }));
  return (() => {
    var _el$2 = getNextElement(_tmpl$2), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, [_el$7, _co$] = getNextMarker(_el$6.nextSibling);
    _el$3.addEventListener("focus", () => local.focusTrigger());
    _el$4.addEventListener("change", (e) => {
      callHandler(e, local.onChange);
      if (!isInternalChangeEvent()) {
        local.selectionManager.setSelectedKeys(/* @__PURE__ */ new Set([e.target.value]));
      }
      setIsInternalChangeEvent(false);
    });
    var _ref$ = mergeRefs((el) => ref = el, local.ref);
    typeof _ref$ === "function" && use(_ref$, _el$4);
    spread(_el$4, mergeProps({
      get multiple() {
        return local.isMultiple;
      },
      get name() {
        return formControlContext.name();
      },
      get required() {
        return formControlContext.isRequired();
      },
      get disabled() {
        return formControlContext.isDisabled();
      },
      get size() {
        return local.collection.getSize();
      },
      get value() {
        return local.selectionManager.firstSelectedKey() ?? "";
      }
    }, others), false, true);
    insert(_el$4, createComponent(Show, {
      get when() {
        return local.isVirtualized;
      },
      get fallback() {
        return createComponent(For, {
          get each() {
            return [...local.collection.getKeys()];
          },
          children: renderOption
        });
      },
      get children() {
        return createComponent(For, {
          get each() {
            return [...local.selectionManager.selectedKeys()];
          },
          children: renderOption
        });
      }
    }), _el$7, _co$);
    createRenderEffect((_p$) => {
      var _v$ = visuallyHiddenStyles, _v$2 = local.selectionManager.isFocused() || local.isOpen ? -1 : 0, _v$3 = formControlContext.isRequired(), _v$4 = formControlContext.isDisabled(), _v$5 = formControlContext.isReadOnly();
      _p$.e = style(_el$2, _v$, _p$.e);
      _v$2 !== _p$.t && setAttribute(_el$3, "tabindex", _p$.t = _v$2);
      _v$3 !== _p$.a && setProperty(_el$3, "required", _p$.a = _v$3);
      _v$4 !== _p$.o && setProperty(_el$3, "disabled", _p$.o = _v$4);
      _v$5 !== _p$.i && setProperty(_el$3, "readOnly", _p$.i = _v$5);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0
    });
    runHydrationEvents();
    return _el$2;
  })();
}
var cache = /* @__PURE__ */ new WeakMap();
function getItemCount(collection) {
  let count = cache.get(collection);
  if (count != null) {
    return count;
  }
  count = 0;
  for (const item of collection) {
    if (item.type === "item") {
      count++;
    }
  }
  cache.set(collection, count);
  return count;
}
var listbox_exports = {};
__export(listbox_exports, {
  Item: () => ListboxItem,
  ItemDescription: () => ListboxItemDescription,
  ItemIndicator: () => ListboxItemIndicator,
  ItemLabel: () => ListboxItemLabel,
  Listbox: () => Listbox,
  Root: () => ListboxRoot,
  Section: () => ListboxSection
});
var ListboxContext = createContext();
function useListboxContext() {
  const context = useContext(ListboxContext);
  if (context === void 0) {
    throw new Error("[kobalte]: `useListboxContext` must be used within a `Listbox` component");
  }
  return context;
}
var ListboxItemContext = createContext();
function useListboxItemContext() {
  const context = useContext(ListboxItemContext);
  if (context === void 0) {
    throw new Error("[kobalte]: `useListboxItemContext` must be used within a `Listbox.Item` component");
  }
  return context;
}
function ListboxItem(props) {
  let ref;
  const listBoxContext = useListboxContext();
  const defaultId = `${listBoxContext.generateId("item")}-${createUniqueId()}`;
  const mergedProps = mergeDefaultProps({
    id: defaultId
  }, props);
  const [local, others] = splitProps(mergedProps, ["ref", "item", "aria-label", "aria-labelledby", "aria-describedby", "onPointerMove", "onPointerDown", "onPointerUp", "onClick", "onKeyDown", "onMouseDown", "onFocus"]);
  const [labelId, setLabelId] = createSignal();
  const [descriptionId, setDescriptionId] = createSignal();
  const selectionManager = () => listBoxContext.listState().selectionManager();
  const isHighlighted = () => selectionManager().focusedKey() === local.item.key;
  const selectableItem = createSelectableItem({
    key: () => local.item.key,
    selectionManager,
    shouldSelectOnPressUp: listBoxContext.shouldSelectOnPressUp,
    allowsDifferentPressOrigin: () => {
      return listBoxContext.shouldSelectOnPressUp() && listBoxContext.shouldFocusOnHover();
    },
    shouldUseVirtualFocus: listBoxContext.shouldUseVirtualFocus,
    disabled: () => local.item.disabled
  }, () => ref);
  const ariaSelected = () => {
    if (selectionManager().selectionMode() === "none") {
      return void 0;
    }
    return selectableItem.isSelected();
  };
  const isNotSafariMacOS = createMemo(() => !(isMac() && isWebKit()));
  const ariaLabel = () => isNotSafariMacOS() ? local["aria-label"] : void 0;
  const ariaLabelledBy = () => isNotSafariMacOS() ? labelId() : void 0;
  const ariaDescribedBy = () => isNotSafariMacOS() ? descriptionId() : void 0;
  const ariaPosInSet = () => {
    if (!listBoxContext.isVirtualized()) {
      return void 0;
    }
    const index = listBoxContext.listState().collection().getItem(local.item.key)?.index;
    return index != null ? index + 1 : void 0;
  };
  const ariaSetSize = () => {
    if (!listBoxContext.isVirtualized()) {
      return void 0;
    }
    return getItemCount(listBoxContext.listState().collection());
  };
  const onPointerMove = (e) => {
    callHandler(e, local.onPointerMove);
    if (e.pointerType !== "mouse") {
      return;
    }
    if (!selectableItem.isDisabled() && listBoxContext.shouldFocusOnHover()) {
      focusWithoutScrolling(e.currentTarget);
      selectionManager().setFocused(true);
      selectionManager().setFocusedKey(local.item.key);
    }
  };
  const dataset = createMemo(() => ({
    "data-disabled": selectableItem.isDisabled() ? "" : void 0,
    "data-selected": selectableItem.isSelected() ? "" : void 0,
    "data-highlighted": isHighlighted() ? "" : void 0
  }));
  const context = {
    isSelected: selectableItem.isSelected,
    dataset,
    generateId: createGenerateId(() => others.id),
    registerLabelId: createRegisterId(setLabelId),
    registerDescriptionId: createRegisterId(setDescriptionId)
  };
  return createComponent(ListboxItemContext.Provider, {
    value: context,
    get children() {
      return createComponent(Polymorphic, mergeProps({
        as: "li",
        ref(r$) {
          var _ref$ = mergeRefs((el) => ref = el, local.ref);
          typeof _ref$ === "function" && _ref$(r$);
        },
        role: "option",
        get tabIndex() {
          return selectableItem.tabIndex();
        },
        get ["aria-disabled"]() {
          return selectableItem.isDisabled();
        },
        get ["aria-selected"]() {
          return ariaSelected();
        },
        get ["aria-label"]() {
          return ariaLabel();
        },
        get ["aria-labelledby"]() {
          return ariaLabelledBy();
        },
        get ["aria-describedby"]() {
          return ariaDescribedBy();
        },
        get ["aria-posinset"]() {
          return ariaPosInSet();
        },
        get ["aria-setsize"]() {
          return ariaSetSize();
        },
        get ["data-key"]() {
          return selectableItem.dataKey();
        },
        get onPointerDown() {
          return composeEventHandlers([local.onPointerDown, selectableItem.onPointerDown]);
        },
        get onPointerUp() {
          return composeEventHandlers([local.onPointerUp, selectableItem.onPointerUp]);
        },
        get onClick() {
          return composeEventHandlers([local.onClick, selectableItem.onClick]);
        },
        get onKeyDown() {
          return composeEventHandlers([local.onKeyDown, selectableItem.onKeyDown]);
        },
        get onMouseDown() {
          return composeEventHandlers([local.onMouseDown, selectableItem.onMouseDown]);
        },
        get onFocus() {
          return composeEventHandlers([local.onFocus, selectableItem.onFocus]);
        },
        onPointerMove
      }, dataset, others));
    }
  });
}
function ListboxItemDescription(props) {
  const context = useListboxItemContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("description")
  }, props);
  createEffect(() => onCleanup(context.registerDescriptionId(mergedProps.id)));
  return createComponent(Polymorphic, mergeProps({
    as: "div"
  }, () => context.dataset(), mergedProps));
}
function ListboxItemIndicator(props) {
  const context = useListboxItemContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("indicator")
  }, props);
  const [local, others] = splitProps(mergedProps, ["forceMount"]);
  return createComponent(Show, {
    get when() {
      return local.forceMount || context.isSelected();
    },
    get children() {
      return createComponent(Polymorphic, mergeProps({
        as: "div",
        "aria-hidden": "true"
      }, () => context.dataset(), others));
    }
  });
}
function ListboxItemLabel(props) {
  const context = useListboxItemContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("label")
  }, props);
  createEffect(() => onCleanup(context.registerLabelId(mergedProps.id)));
  return createComponent(Polymorphic, mergeProps({
    as: "div"
  }, () => context.dataset(), mergedProps));
}
function ListboxRoot(props) {
  let ref;
  const defaultId = `listbox-${createUniqueId()}`;
  const mergedProps = mergeDefaultProps({
    id: defaultId,
    selectionMode: "single",
    virtualized: false
  }, props);
  const [local, others] = splitProps(mergedProps, ["ref", "children", "renderItem", "renderSection", "value", "defaultValue", "onChange", "options", "optionValue", "optionTextValue", "optionDisabled", "optionGroupChildren", "state", "keyboardDelegate", "autoFocus", "selectionMode", "shouldFocusWrap", "shouldUseVirtualFocus", "shouldSelectOnPressUp", "shouldFocusOnHover", "allowDuplicateSelectionEvents", "disallowEmptySelection", "selectionBehavior", "selectOnFocus", "disallowTypeAhead", "allowsTabNavigation", "virtualized", "scrollToItem", "scrollRef", "onKeyDown", "onMouseDown", "onFocusIn", "onFocusOut"]);
  const listState = createMemo(() => {
    if (local.state) {
      return local.state;
    }
    return createListState({
      selectedKeys: () => local.value,
      defaultSelectedKeys: () => local.defaultValue,
      onSelectionChange: local.onChange,
      allowDuplicateSelectionEvents: () => access(local.allowDuplicateSelectionEvents),
      disallowEmptySelection: () => access(local.disallowEmptySelection),
      selectionBehavior: () => access(local.selectionBehavior),
      selectionMode: () => access(local.selectionMode),
      dataSource: () => local.options ?? [],
      getKey: () => local.optionValue,
      getTextValue: () => local.optionTextValue,
      getDisabled: () => local.optionDisabled,
      getSectionChildren: () => local.optionGroupChildren
    });
  });
  const selectableList = createSelectableList({
    selectionManager: () => listState().selectionManager(),
    collection: () => listState().collection(),
    autoFocus: () => access(local.autoFocus),
    shouldFocusWrap: () => access(local.shouldFocusWrap),
    keyboardDelegate: () => local.keyboardDelegate,
    disallowEmptySelection: () => access(local.disallowEmptySelection),
    selectOnFocus: () => access(local.selectOnFocus),
    disallowTypeAhead: () => access(local.disallowTypeAhead),
    shouldUseVirtualFocus: () => access(local.shouldUseVirtualFocus),
    allowsTabNavigation: () => access(local.allowsTabNavigation),
    isVirtualized: () => local.virtualized,
    scrollToKey: () => local.scrollToItem
  }, () => ref, () => local.scrollRef?.());
  const context = {
    listState,
    generateId: createGenerateId(() => others.id),
    shouldUseVirtualFocus: () => mergedProps.shouldUseVirtualFocus,
    shouldSelectOnPressUp: () => mergedProps.shouldSelectOnPressUp,
    shouldFocusOnHover: () => mergedProps.shouldFocusOnHover,
    isVirtualized: () => local.virtualized
  };
  return createComponent(ListboxContext.Provider, {
    value: context,
    get children() {
      return createComponent(Polymorphic, mergeProps({
        as: "ul",
        ref(r$) {
          var _ref$2 = mergeRefs((el) => ref = el, local.ref);
          typeof _ref$2 === "function" && _ref$2(r$);
        },
        role: "listbox",
        get tabIndex() {
          return selectableList.tabIndex();
        },
        get ["aria-multiselectable"]() {
          return listState().selectionManager().selectionMode() === "multiple" ? true : void 0;
        },
        get onKeyDown() {
          return composeEventHandlers([local.onKeyDown, selectableList.onKeyDown]);
        },
        get onMouseDown() {
          return composeEventHandlers([local.onMouseDown, selectableList.onMouseDown]);
        },
        get onFocusIn() {
          return composeEventHandlers([local.onFocusIn, selectableList.onFocusIn]);
        },
        get onFocusOut() {
          return composeEventHandlers([local.onFocusOut, selectableList.onFocusOut]);
        }
      }, others, {
        get children() {
          return createComponent(Show, {
            get when() {
              return !local.virtualized;
            },
            get fallback() {
              return local.children?.(listState().collection);
            },
            get children() {
              return createComponent(Key, {
                get each() {
                  return [...listState().collection()];
                },
                by: "key",
                children: (item) => createComponent(Switch, {
                  get children() {
                    return [createComponent(Match, {
                      get when() {
                        return item().type === "section";
                      },
                      get children() {
                        return local.renderSection?.(item());
                      }
                    }), createComponent(Match, {
                      get when() {
                        return item().type === "item";
                      },
                      get children() {
                        return local.renderItem?.(item());
                      }
                    })];
                  }
                })
              });
            }
          });
        }
      }));
    }
  });
}
function ListboxSection(props) {
  return createComponent(Polymorphic, mergeProps({
    as: "li",
    role: "presentation"
  }, props));
}
var Listbox = Object.assign(ListboxRoot, {
  Item: ListboxItem,
  ItemDescription: ListboxItemDescription,
  ItemIndicator: ListboxItemIndicator,
  ItemLabel: ListboxItemLabel,
  Section: ListboxSection
});
var select_exports = {};
__export(select_exports, {
  Arrow: () => PopperArrow,
  Content: () => SelectContent,
  Description: () => FormControlDescription,
  ErrorMessage: () => FormControlErrorMessage,
  HiddenSelect: () => SelectHiddenSelect,
  Icon: () => SelectIcon,
  Item: () => ListboxItem,
  ItemDescription: () => ListboxItemDescription,
  ItemIndicator: () => ListboxItemIndicator,
  ItemLabel: () => ListboxItemLabel,
  Label: () => SelectLabel,
  Listbox: () => SelectListbox,
  Portal: () => SelectPortal,
  Root: () => SelectRoot,
  Section: () => ListboxSection,
  Select: () => Select,
  Trigger: () => SelectTrigger,
  Value: () => SelectValue
});
var SelectContext = createContext();
function useSelectContext() {
  const context = useContext(SelectContext);
  if (context === void 0) {
    throw new Error("[kobalte]: `useSelectContext` must be used within a `Select` component");
  }
  return context;
}
function SelectContent(props) {
  let ref;
  const context = useSelectContext();
  const [local, others] = splitProps(props, ["ref", "style", "onCloseAutoFocus", "onFocusOutside"]);
  const onEscapeKeyDown = (e) => {
    context.close();
  };
  const onFocusOutside = (e) => {
    local.onFocusOutside?.(e);
    if (context.isOpen() && context.isModal()) {
      e.preventDefault();
    }
  };
  createHideOutside({
    isDisabled: () => !(context.isOpen() && context.isModal()),
    targets: () => ref ? [ref] : []
  });
  src_default({
    element: () => ref ?? null,
    enabled: () => context.contentPresent() && context.preventScroll()
  });
  createFocusScope({
    trapFocus: () => context.isOpen() && context.isModal(),
    onMountAutoFocus: (e) => {
      e.preventDefault();
    },
    onUnmountAutoFocus: (e) => {
      local.onCloseAutoFocus?.(e);
      if (!e.defaultPrevented) {
        focusWithoutScrolling(context.triggerRef());
        e.preventDefault();
      }
    }
  }, () => ref);
  return createComponent(Show, {
    get when() {
      return context.contentPresent();
    },
    get children() {
      return createComponent(Popper.Positioner, {
        get children() {
          return createComponent(DismissableLayer, mergeProps({
            ref(r$) {
              var _ref$ = mergeRefs((el) => {
                context.setContentRef(el);
                ref = el;
              }, local.ref);
              typeof _ref$ === "function" && _ref$(r$);
            },
            get disableOutsidePointerEvents() {
              return memo(() => !!context.isModal())() && context.isOpen();
            },
            get excludedElements() {
              return [context.triggerRef];
            },
            get style() {
              return combineStyle({
                "--kb-select-content-transform-origin": "var(--kb-popper-content-transform-origin)",
                position: "relative"
              }, local.style);
            },
            onEscapeKeyDown,
            onFocusOutside,
            get onDismiss() {
              return context.close;
            }
          }, () => context.dataset(), others));
        }
      });
    }
  });
}
function SelectHiddenSelect(props) {
  const context = useSelectContext();
  return createComponent(HiddenSelectBase, mergeProps({
    get collection() {
      return context.listState().collection();
    },
    get selectionManager() {
      return context.listState().selectionManager();
    },
    get isOpen() {
      return context.isOpen();
    },
    get isMultiple() {
      return context.isMultiple();
    },
    get isVirtualized() {
      return context.isVirtualized();
    },
    focusTrigger: () => context.triggerRef()?.focus()
  }, props));
}
function SelectIcon(props) {
  const context = useSelectContext();
  const mergedProps = mergeDefaultProps({
    children: "▼"
  }, props);
  return createComponent(Polymorphic, mergeProps({
    as: "span",
    "aria-hidden": "true"
  }, () => context.dataset(), mergedProps));
}
function SelectLabel(props) {
  const context = useSelectContext();
  const [local, others] = splitProps(props, ["onClick"]);
  const onClick = (e) => {
    callHandler(e, local.onClick);
    if (!context.isDisabled()) {
      context.triggerRef()?.focus();
    }
  };
  return createComponent(FormControlLabel, mergeProps({
    as: "span",
    onClick
  }, others));
}
function SelectListbox(props) {
  const context = useSelectContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("listbox")
  }, props);
  const [local, others] = splitProps(mergedProps, ["ref", "id", "onKeyDown"]);
  createEffect(() => onCleanup(context.registerListboxId(local.id)));
  const onKeyDown = (e) => {
    callHandler(e, local.onKeyDown);
    if (e.key === "Escape") {
      e.preventDefault();
    }
  };
  return createComponent(ListboxRoot, mergeProps({
    ref(r$) {
      var _ref$2 = mergeRefs(context.setListboxRef, local.ref);
      typeof _ref$2 === "function" && _ref$2(r$);
    },
    get id() {
      return local.id;
    },
    get state() {
      return context.listState();
    },
    get virtualized() {
      return context.isVirtualized();
    },
    get autoFocus() {
      return context.autoFocus();
    },
    shouldSelectOnPressUp: true,
    shouldFocusOnHover: true,
    get shouldFocusWrap() {
      return context.shouldFocusWrap();
    },
    get disallowTypeAhead() {
      return context.disallowTypeAhead();
    },
    get ["aria-labelledby"]() {
      return context.listboxAriaLabelledBy();
    },
    get renderItem() {
      return context.renderItem;
    },
    get renderSection() {
      return context.renderSection;
    },
    onKeyDown
  }, others));
}
function SelectPortal(props) {
  const context = useSelectContext();
  return createComponent(Show, {
    get when() {
      return context.contentPresent();
    },
    get children() {
      return createComponent(Portal, props);
    }
  });
}
function SelectBase(props) {
  const defaultId = `select-${createUniqueId()}`;
  const mergedProps = mergeDefaultProps({
    id: defaultId,
    selectionMode: "single",
    disallowEmptySelection: false,
    closeOnSelection: props.selectionMode === "single",
    allowDuplicateSelectionEvents: true,
    gutter: 8,
    sameWidth: true,
    modal: false
  }, props);
  const [local, popperProps, formControlProps, others] = splitProps(mergedProps, ["itemComponent", "sectionComponent", "open", "defaultOpen", "onOpenChange", "value", "defaultValue", "onChange", "placeholder", "options", "optionValue", "optionTextValue", "optionDisabled", "optionGroupChildren", "keyboardDelegate", "allowDuplicateSelectionEvents", "disallowEmptySelection", "closeOnSelection", "disallowTypeAhead", "shouldFocusWrap", "selectionBehavior", "selectionMode", "virtualized", "modal", "preventScroll", "forceMount"], ["getAnchorRect", "placement", "gutter", "shift", "flip", "slide", "overlap", "sameWidth", "fitViewport", "hideWhenDetached", "detachedPadding", "arrowPadding", "overflowPadding"], FORM_CONTROL_PROP_NAMES);
  const [triggerId, setTriggerId] = createSignal();
  const [valueId, setValueId] = createSignal();
  const [listboxId, setListboxId] = createSignal();
  const [triggerRef, setTriggerRef] = createSignal();
  const [contentRef, setContentRef] = createSignal();
  const [listboxRef, setListboxRef] = createSignal();
  const [listboxAriaLabelledBy, setListboxAriaLabelledBy] = createSignal();
  const [focusStrategy, setFocusStrategy] = createSignal(true);
  const getOptionValue = (option) => {
    const optionValue = local.optionValue;
    if (optionValue == null) {
      return String(option);
    }
    return String(isFunction(optionValue) ? optionValue(option) : option[optionValue]);
  };
  const flattenOptions = createMemo(() => {
    const optionGroupChildren = local.optionGroupChildren;
    if (optionGroupChildren == null) {
      return local.options;
    }
    return local.options.flatMap((item) => item[optionGroupChildren] ?? item);
  });
  const flattenOptionKeys = createMemo(() => {
    return flattenOptions().map((option) => getOptionValue(option));
  });
  const getOptionsFromValues = (values) => {
    return [...values].map((value) => flattenOptions().find((option) => getOptionValue(option) === value)).filter((option) => option != null);
  };
  const disclosureState = createDisclosureState({
    open: () => local.open,
    defaultOpen: () => local.defaultOpen,
    onOpenChange: (isOpen) => local.onOpenChange?.(isOpen)
  });
  const listState = createListState({
    selectedKeys: () => {
      if (local.value != null) {
        return local.value.map(getOptionValue);
      }
      return local.value;
    },
    defaultSelectedKeys: () => {
      if (local.defaultValue != null) {
        return local.defaultValue.map(getOptionValue);
      }
      return local.defaultValue;
    },
    onSelectionChange: (selectedKeys) => {
      local.onChange?.(getOptionsFromValues(selectedKeys));
      if (local.closeOnSelection) {
        close();
      }
    },
    allowDuplicateSelectionEvents: () => access(local.allowDuplicateSelectionEvents),
    disallowEmptySelection: () => access(local.disallowEmptySelection),
    selectionBehavior: () => access(local.selectionBehavior),
    selectionMode: () => local.selectionMode,
    dataSource: () => local.options ?? [],
    getKey: () => local.optionValue,
    getTextValue: () => local.optionTextValue,
    getDisabled: () => local.optionDisabled,
    getSectionChildren: () => local.optionGroupChildren
  });
  const selectedOptions = createMemo(() => {
    return getOptionsFromValues(listState.selectionManager().selectedKeys());
  });
  const removeOptionFromSelection = (option) => {
    listState.selectionManager().toggleSelection(getOptionValue(option));
  };
  const {
    present: contentPresent
  } = src_default$1({
    show: () => local.forceMount || disclosureState.isOpen(),
    element: () => contentRef() ?? null
  });
  const focusListbox = () => {
    const listboxEl = listboxRef();
    if (listboxEl) {
      focusWithoutScrolling(listboxEl);
    }
  };
  const open = (focusStrategy2) => {
    if (local.options.length <= 0) {
      return;
    }
    setFocusStrategy(focusStrategy2);
    disclosureState.open();
    let focusedKey = listState.selectionManager().firstSelectedKey();
    if (focusedKey == null) {
      if (focusStrategy2 === "first") {
        focusedKey = listState.collection().getFirstKey();
      } else if (focusStrategy2 === "last") {
        focusedKey = listState.collection().getLastKey();
      }
    }
    focusListbox();
    listState.selectionManager().setFocused(true);
    listState.selectionManager().setFocusedKey(focusedKey);
  };
  const close = () => {
    disclosureState.close();
    listState.selectionManager().setFocused(false);
    listState.selectionManager().setFocusedKey(void 0);
  };
  const toggle = (focusStrategy2) => {
    if (disclosureState.isOpen()) {
      close();
    } else {
      open(focusStrategy2);
    }
  };
  const {
    formControlContext
  } = createFormControl(formControlProps);
  createFormResetListener(triggerRef, () => {
    const defaultSelectedKeys = local.defaultValue ? [...local.defaultValue].map(getOptionValue) : new Selection();
    listState.selectionManager().setSelectedKeys(defaultSelectedKeys);
  });
  const collator = createCollator({
    usage: "search",
    sensitivity: "base"
  });
  const delegate = createMemo(() => {
    const keyboardDelegate = access(local.keyboardDelegate);
    if (keyboardDelegate) {
      return keyboardDelegate;
    }
    return new ListKeyboardDelegate(listState.collection, void 0, collator);
  });
  const renderItem = (item) => {
    return local.itemComponent?.({
      item
    });
  };
  const renderSection = (section) => {
    return local.sectionComponent?.({
      section
    });
  };
  createEffect(on([flattenOptionKeys], ([flattenOptionKeys2]) => {
    const currentSelectedKeys = [...listState.selectionManager().selectedKeys()];
    const keysToKeep = currentSelectedKeys.filter((key) => flattenOptionKeys2.includes(key));
    listState.selectionManager().setSelectedKeys(keysToKeep);
  }, {
    defer: true
  }));
  const dataset = createMemo(() => ({
    "data-expanded": disclosureState.isOpen() ? "" : void 0,
    "data-closed": !disclosureState.isOpen() ? "" : void 0
  }));
  const context = {
    dataset,
    isOpen: disclosureState.isOpen,
    isDisabled: () => formControlContext.isDisabled() ?? false,
    isMultiple: () => access(local.selectionMode) === "multiple",
    isVirtualized: () => local.virtualized ?? false,
    isModal: () => local.modal ?? false,
    preventScroll: () => local.preventScroll ?? context.isModal(),
    disallowTypeAhead: () => local.disallowTypeAhead ?? false,
    shouldFocusWrap: () => local.shouldFocusWrap ?? false,
    selectedOptions,
    contentPresent,
    autoFocus: focusStrategy,
    triggerRef,
    listState: () => listState,
    keyboardDelegate: delegate,
    triggerId,
    valueId,
    listboxId,
    listboxAriaLabelledBy,
    setListboxAriaLabelledBy,
    setTriggerRef,
    setContentRef,
    setListboxRef,
    open,
    close,
    toggle,
    placeholder: () => local.placeholder,
    renderItem,
    renderSection,
    removeOptionFromSelection,
    generateId: createGenerateId(() => access(formControlProps.id)),
    registerTriggerId: createRegisterId(setTriggerId),
    registerValueId: createRegisterId(setValueId),
    registerListboxId: createRegisterId(setListboxId)
  };
  return createComponent(FormControlContext.Provider, {
    value: formControlContext,
    get children() {
      return createComponent(SelectContext.Provider, {
        value: context,
        get children() {
          return createComponent(Popper, mergeProps({
            anchorRef: triggerRef,
            contentRef
          }, popperProps, {
            get children() {
              return createComponent(Polymorphic, mergeProps({
                as: "div",
                role: "group",
                get id() {
                  return access(formControlProps.id);
                }
              }, () => formControlContext.dataset(), dataset, others));
            }
          }));
        }
      });
    }
  });
}
function SelectRoot(props) {
  const [local, others] = splitProps(props, ["value", "defaultValue", "onChange", "multiple"]);
  const value = createMemo(() => {
    if (local.value != null) {
      return local.multiple ? local.value : [local.value];
    }
    return local.value;
  });
  const defaultValue = createMemo(() => {
    if (local.defaultValue != null) {
      return local.multiple ? local.defaultValue : [local.defaultValue];
    }
    return local.defaultValue;
  });
  const onChange = (value2) => {
    if (local.multiple) {
      local.onChange?.(value2 ?? []);
    } else {
      local.onChange?.(value2[0] ?? null);
    }
  };
  return createComponent(SelectBase, mergeProps({
    get value() {
      return value();
    },
    get defaultValue() {
      return defaultValue();
    },
    onChange,
    get selectionMode() {
      return local.multiple ? "multiple" : "single";
    }
  }, others));
}
function SelectTrigger(props) {
  const formControlContext = useFormControlContext();
  const context = useSelectContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("trigger")
  }, props);
  const [local, formControlFieldProps, others] = splitProps(mergedProps, ["ref", "disabled", "onPointerDown", "onClick", "onKeyDown", "onFocus", "onBlur"], FORM_CONTROL_FIELD_PROP_NAMES);
  const selectionManager = () => context.listState().selectionManager();
  const keyboardDelegate = () => context.keyboardDelegate();
  const isDisabled = () => local.disabled || context.isDisabled();
  const {
    fieldProps
  } = createFormControlField(formControlFieldProps);
  const {
    typeSelectHandlers
  } = createTypeSelect({
    keyboardDelegate,
    selectionManager,
    onTypeSelect: (key) => selectionManager().select(key)
  });
  const ariaLabelledBy = () => {
    return [context.listboxAriaLabelledBy(), context.valueId()].filter(Boolean).join(" ") || void 0;
  };
  const onPointerDown = (e) => {
    callHandler(e, local.onPointerDown);
    e.currentTarget.dataset.pointerType = e.pointerType;
    if (!isDisabled() && e.pointerType !== "touch" && e.button === 0) {
      e.preventDefault();
      context.toggle(true);
    }
  };
  const onClick = (e) => {
    callHandler(e, local.onClick);
    if (!isDisabled() && e.currentTarget.dataset.pointerType === "touch") {
      context.toggle(true);
    }
  };
  const onKeyDown = (e) => {
    callHandler(e, local.onKeyDown);
    if (isDisabled()) {
      return;
    }
    callHandler(e, typeSelectHandlers.onKeyDown);
    switch (e.key) {
      case "Enter":
      case " ":
      case "ArrowDown":
        e.stopPropagation();
        e.preventDefault();
        context.toggle("first");
        break;
      case "ArrowUp":
        e.stopPropagation();
        e.preventDefault();
        context.toggle("last");
        break;
      case "ArrowLeft": {
        e.preventDefault();
        if (context.isMultiple()) {
          return;
        }
        const firstSelectedKey = selectionManager().firstSelectedKey();
        const key = firstSelectedKey != null ? keyboardDelegate().getKeyAbove?.(firstSelectedKey) : keyboardDelegate().getFirstKey?.();
        if (key != null) {
          selectionManager().select(key);
        }
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        if (context.isMultiple()) {
          return;
        }
        const firstSelectedKey = selectionManager().firstSelectedKey();
        const key = firstSelectedKey != null ? keyboardDelegate().getKeyBelow?.(firstSelectedKey) : keyboardDelegate().getFirstKey?.();
        if (key != null) {
          selectionManager().select(key);
        }
        break;
      }
    }
  };
  const onFocus = (e) => {
    callHandler(e, local.onFocus);
    if (selectionManager().isFocused()) {
      return;
    }
    selectionManager().setFocused(true);
  };
  const onBlur = (e) => {
    callHandler(e, local.onBlur);
    if (context.isOpen()) {
      return;
    }
    selectionManager().setFocused(false);
  };
  createEffect(() => onCleanup(context.registerTriggerId(fieldProps.id())));
  createEffect(() => {
    context.setListboxAriaLabelledBy([fieldProps.ariaLabelledBy(), fieldProps.ariaLabel() && !fieldProps.ariaLabelledBy() ? fieldProps.id() : null].filter(Boolean).join(" ") || void 0);
  });
  return createComponent(ButtonRoot, mergeProps({
    ref(r$) {
      var _ref$3 = mergeRefs(context.setTriggerRef, local.ref);
      typeof _ref$3 === "function" && _ref$3(r$);
    },
    get id() {
      return fieldProps.id();
    },
    get disabled() {
      return isDisabled();
    },
    "aria-haspopup": "listbox",
    get ["aria-expanded"]() {
      return context.isOpen();
    },
    get ["aria-controls"]() {
      return memo(() => !!context.isOpen())() ? context.listboxId() : void 0;
    },
    get ["aria-label"]() {
      return fieldProps.ariaLabel();
    },
    get ["aria-labelledby"]() {
      return ariaLabelledBy();
    },
    get ["aria-describedby"]() {
      return fieldProps.ariaDescribedBy();
    },
    onPointerDown,
    onClick,
    onKeyDown,
    onFocus,
    onBlur
  }, () => context.dataset(), () => formControlContext.dataset(), others));
}
function SelectValue(props) {
  const formControlContext = useFormControlContext();
  const context = useSelectContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("value")
  }, props);
  const [local, others] = splitProps(mergedProps, ["id", "children"]);
  const selectionManager = () => context.listState().selectionManager();
  const isSelectionEmpty = () => {
    const selectedKeys = selectionManager().selectedKeys();
    if (selectedKeys.size === 1 && selectedKeys.has("")) {
      return true;
    }
    return selectionManager().isEmpty();
  };
  createEffect(() => onCleanup(context.registerValueId(local.id)));
  return createComponent(Polymorphic, mergeProps({
    as: "span",
    get id() {
      return local.id;
    },
    get ["data-placeholder-shown"]() {
      return isSelectionEmpty() ? "" : void 0;
    }
  }, () => formControlContext.dataset(), others, {
    get children() {
      return createComponent(Show, {
        get when() {
          return !isSelectionEmpty();
        },
        get fallback() {
          return context.placeholder();
        },
        get children() {
          return createComponent(SelectValueChild, {
            state: {
              selectedOption: () => context.selectedOptions()[0],
              selectedOptions: () => context.selectedOptions(),
              remove: (option) => context.removeOptionFromSelection(option),
              clear: () => selectionManager().clearSelection()
            },
            get children() {
              return local.children;
            }
          });
        }
      });
    }
  }));
}
function SelectValueChild(props) {
  const resolvedChildren = children(() => {
    const body = props.children;
    return isFunction(body) ? body(props.state) : body;
  });
  return memo(resolvedChildren);
}
var Select = Object.assign(SelectRoot, {
  Arrow: PopperArrow,
  Content: SelectContent,
  Description: FormControlDescription,
  ErrorMessage: FormControlErrorMessage,
  HiddenSelect: SelectHiddenSelect,
  Icon: SelectIcon,
  Item: ListboxItem,
  ItemDescription: ListboxItemDescription,
  ItemIndicator: ListboxItemIndicator,
  ItemLabel: ListboxItemLabel,
  Label: SelectLabel,
  Listbox: SelectListbox,
  Portal: SelectPortal,
  Section: ListboxSection,
  Trigger: SelectTrigger,
  Value: SelectValue
});
var popover_exports = {};
__export(popover_exports, {
  Anchor: () => PopoverAnchor,
  Arrow: () => PopperArrow,
  CloseButton: () => PopoverCloseButton,
  Content: () => PopoverContent,
  Description: () => PopoverDescription,
  Popover: () => Popover,
  Portal: () => PopoverPortal,
  Root: () => PopoverRoot,
  Title: () => PopoverTitle,
  Trigger: () => PopoverTrigger
});
var PopoverContext = createContext();
function usePopoverContext() {
  const context = useContext(PopoverContext);
  if (context === void 0) {
    throw new Error("[kobalte]: `usePopoverContext` must be used within a `Popover` component");
  }
  return context;
}
function PopoverAnchor(props) {
  const context = usePopoverContext();
  const [local, others] = splitProps(props, ["ref"]);
  return createComponent(Polymorphic, mergeProps({
    as: "div",
    ref(r$) {
      var _ref$ = mergeRefs(context.setDefaultAnchorRef, local.ref);
      typeof _ref$ === "function" && _ref$(r$);
    }
  }, () => context.dataset(), others));
}
function PopoverCloseButton(props) {
  const context = usePopoverContext();
  const [local, others] = splitProps(props, ["aria-label", "onClick"]);
  const onClick = (e) => {
    callHandler(e, local.onClick);
    context.close();
  };
  return createComponent(ButtonRoot, mergeProps({
    get ["aria-label"]() {
      return local["aria-label"] || context.translations().dismiss;
    },
    onClick
  }, () => context.dataset(), others));
}
function PopoverContent(props) {
  let ref;
  const context = usePopoverContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("content")
  }, props);
  const [local, others] = splitProps(mergedProps, ["ref", "style", "onOpenAutoFocus", "onCloseAutoFocus", "onPointerDownOutside", "onFocusOutside", "onInteractOutside"]);
  let isRightClickOutside = false;
  let hasInteractedOutside = false;
  let hasPointerDownOutside = false;
  const onCloseAutoFocus = (e) => {
    local.onCloseAutoFocus?.(e);
    if (context.isModal()) {
      e.preventDefault();
      if (!isRightClickOutside) {
        focusWithoutScrolling(context.triggerRef());
      }
    } else {
      if (!e.defaultPrevented) {
        if (!hasInteractedOutside) {
          focusWithoutScrolling(context.triggerRef());
        }
        e.preventDefault();
      }
      hasInteractedOutside = false;
      hasPointerDownOutside = false;
    }
  };
  const onPointerDownOutside = (e) => {
    local.onPointerDownOutside?.(e);
    if (context.isModal()) {
      isRightClickOutside = e.detail.isContextMenu;
    }
  };
  const onFocusOutside = (e) => {
    local.onFocusOutside?.(e);
    if (context.isOpen() && context.isModal()) {
      e.preventDefault();
    }
  };
  const onInteractOutside = (e) => {
    local.onInteractOutside?.(e);
    if (context.isModal()) {
      return;
    }
    if (!e.defaultPrevented) {
      hasInteractedOutside = true;
      if (e.detail.originalEvent.type === "pointerdown") {
        hasPointerDownOutside = true;
      }
    }
    if (contains(context.triggerRef(), e.target)) {
      e.preventDefault();
    }
    if (e.detail.originalEvent.type === "focusin" && hasPointerDownOutside) {
      e.preventDefault();
    }
  };
  createHideOutside({
    isDisabled: () => !(context.isOpen() && context.isModal()),
    targets: () => ref ? [ref] : []
  });
  src_default({
    element: () => ref ?? null,
    enabled: () => context.contentPresent() && context.preventScroll()
  });
  createFocusScope({
    trapFocus: () => context.isOpen() && context.isModal(),
    onMountAutoFocus: local.onOpenAutoFocus,
    onUnmountAutoFocus: onCloseAutoFocus
  }, () => ref);
  createEffect(() => onCleanup(context.registerContentId(others.id)));
  return createComponent(Show, {
    get when() {
      return context.contentPresent();
    },
    get children() {
      return createComponent(Popper.Positioner, {
        get children() {
          return createComponent(DismissableLayer, mergeProps({
            ref(r$) {
              var _ref$2 = mergeRefs((el) => {
                context.setContentRef(el);
                ref = el;
              }, local.ref);
              typeof _ref$2 === "function" && _ref$2(r$);
            },
            role: "dialog",
            tabIndex: -1,
            get disableOutsidePointerEvents() {
              return memo(() => !!context.isOpen())() && context.isModal();
            },
            get excludedElements() {
              return [context.triggerRef];
            },
            get style() {
              return combineStyle({
                "--kb-popover-content-transform-origin": "var(--kb-popper-content-transform-origin)",
                position: "relative"
              }, local.style);
            },
            get ["aria-labelledby"]() {
              return context.titleId();
            },
            get ["aria-describedby"]() {
              return context.descriptionId();
            },
            onPointerDownOutside,
            onFocusOutside,
            onInteractOutside,
            get onDismiss() {
              return context.close;
            }
          }, () => context.dataset(), others));
        }
      });
    }
  });
}
function PopoverDescription(props) {
  const context = usePopoverContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("description")
  }, props);
  const [local, others] = splitProps(mergedProps, ["id"]);
  createEffect(() => onCleanup(context.registerDescriptionId(local.id)));
  return createComponent(Polymorphic, mergeProps({
    as: "p",
    get id() {
      return local.id;
    }
  }, () => context.dataset(), others));
}
function PopoverPortal(props) {
  const context = usePopoverContext();
  return createComponent(Show, {
    get when() {
      return context.contentPresent();
    },
    get children() {
      return createComponent(Portal, props);
    }
  });
}
var POPOVER_INTL_TRANSLATIONS = {
  // `aria-label` of Popover.CloseButton.
  dismiss: "Dismiss"
};
function PopoverRoot(props) {
  const defaultId = `popover-${createUniqueId()}`;
  const mergedProps = mergeDefaultProps({
    id: defaultId,
    modal: false,
    translations: POPOVER_INTL_TRANSLATIONS
  }, props);
  const [local, others] = splitProps(mergedProps, ["translations", "id", "open", "defaultOpen", "onOpenChange", "modal", "preventScroll", "forceMount", "anchorRef"]);
  const [defaultAnchorRef, setDefaultAnchorRef] = createSignal();
  const [triggerRef, setTriggerRef] = createSignal();
  const [contentRef, setContentRef] = createSignal();
  const [contentId, setContentId] = createSignal();
  const [titleId, setTitleId] = createSignal();
  const [descriptionId, setDescriptionId] = createSignal();
  const disclosureState = createDisclosureState({
    open: () => local.open,
    defaultOpen: () => local.defaultOpen,
    onOpenChange: (isOpen) => local.onOpenChange?.(isOpen)
  });
  const anchorRef = () => {
    return local.anchorRef?.() ?? defaultAnchorRef() ?? triggerRef();
  };
  const {
    present: contentPresent
  } = src_default$1({
    show: () => local.forceMount || disclosureState.isOpen(),
    element: () => contentRef() ?? null
  });
  const dataset = createMemo(() => ({
    "data-expanded": disclosureState.isOpen() ? "" : void 0,
    "data-closed": !disclosureState.isOpen() ? "" : void 0
  }));
  const context = {
    translations: () => local.translations ?? POPOVER_INTL_TRANSLATIONS,
    dataset,
    isOpen: disclosureState.isOpen,
    isModal: () => local.modal ?? false,
    preventScroll: () => local.preventScroll ?? context.isModal(),
    contentPresent,
    triggerRef,
    contentId,
    titleId,
    descriptionId,
    setDefaultAnchorRef,
    setTriggerRef,
    setContentRef,
    close: disclosureState.close,
    toggle: disclosureState.toggle,
    generateId: createGenerateId(() => local.id),
    registerContentId: createRegisterId(setContentId),
    registerTitleId: createRegisterId(setTitleId),
    registerDescriptionId: createRegisterId(setDescriptionId)
  };
  return createComponent(PopoverContext.Provider, {
    value: context,
    get children() {
      return createComponent(Popper, mergeProps({
        anchorRef,
        contentRef
      }, others));
    }
  });
}
function PopoverTitle(props) {
  const context = usePopoverContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("title")
  }, props);
  const [local, others] = splitProps(mergedProps, ["id"]);
  createEffect(() => onCleanup(context.registerTitleId(local.id)));
  return createComponent(Polymorphic, mergeProps({
    as: "h2",
    get id() {
      return local.id;
    }
  }, () => context.dataset(), others));
}
function PopoverTrigger(props) {
  const context = usePopoverContext();
  const [local, others] = splitProps(props, ["ref", "onClick", "onPointerDown"]);
  const onPointerDown = (e) => {
    callHandler(e, local.onPointerDown);
    e.preventDefault();
  };
  const onClick = (e) => {
    callHandler(e, local.onClick);
    context.toggle();
  };
  return createComponent(ButtonRoot, mergeProps({
    ref(r$) {
      var _ref$3 = mergeRefs(context.setTriggerRef, local.ref);
      typeof _ref$3 === "function" && _ref$3(r$);
    },
    "aria-haspopup": "dialog",
    get ["aria-expanded"]() {
      return context.isOpen();
    },
    get ["aria-controls"]() {
      return memo(() => !!context.isOpen())() ? context.contentId() : void 0;
    },
    onPointerDown,
    onClick
  }, () => context.dataset(), others));
}
var Popover = Object.assign(PopoverRoot, {
  Anchor: PopoverAnchor,
  Arrow: PopperArrow,
  CloseButton: PopoverCloseButton,
  Content: PopoverContent,
  Description: PopoverDescription,
  Portal: PopoverPortal,
  Title: PopoverTitle,
  Trigger: PopoverTrigger
});
var context_menu_exports = {};
__export(context_menu_exports, {
  Arrow: () => PopperArrow,
  CheckboxItem: () => MenuCheckboxItem,
  Content: () => ContextMenuContent,
  ContextMenu: () => ContextMenu,
  Group: () => MenuGroup,
  GroupLabel: () => MenuGroupLabel,
  Icon: () => MenuIcon,
  Item: () => MenuItem,
  ItemDescription: () => MenuItemDescription,
  ItemIndicator: () => MenuItemIndicator,
  ItemLabel: () => MenuItemLabel,
  Portal: () => MenuPortal,
  RadioGroup: () => MenuRadioGroup,
  RadioItem: () => MenuRadioItem,
  Root: () => ContextMenuRoot,
  Separator: () => SeparatorRoot,
  Sub: () => MenuSub,
  SubContent: () => MenuSubContent,
  SubTrigger: () => MenuSubTrigger,
  Trigger: () => ContextMenuTrigger
});
function ContextMenuContent(props) {
  const rootContext = useMenuRootContext();
  const [local, others] = splitProps(props, ["onCloseAutoFocus", "onInteractOutside"]);
  let hasInteractedOutside = false;
  const onCloseAutoFocus = (e) => {
    local.onCloseAutoFocus?.(e);
    if (!e.defaultPrevented && hasInteractedOutside) {
      e.preventDefault();
    }
    hasInteractedOutside = false;
  };
  const onInteractOutside = (e) => {
    local.onInteractOutside?.(e);
    if (!e.defaultPrevented && !rootContext.isModal()) {
      hasInteractedOutside = true;
    }
  };
  return createComponent(MenuContent, mergeProps({
    onCloseAutoFocus,
    onInteractOutside
  }, others));
}
var ContextMenuContext = createContext();
function useOptionalContextMenuContext() {
  return useContext(ContextMenuContext);
}
function useContextMenuContext() {
  const context = useOptionalContextMenuContext();
  if (context === void 0) {
    throw new Error("[kobalte]: `useContextMenuContext` must be used within a `ContextMenu` component");
  }
  return context;
}
function ContextMenuRoot(props) {
  const defaultId = `contextmenu-${createUniqueId()}`;
  const {
    direction
  } = useLocale();
  const mergedProps = mergeDefaultProps({
    id: defaultId,
    placement: direction() === "rtl" ? "left-start" : "right-start",
    gutter: 2,
    shift: 2
  }, props);
  const [local, others] = splitProps(mergedProps, ["onOpenChange"]);
  const [anchorRect, setAnchorRect] = createSignal({
    x: 0,
    y: 0
  });
  const disclosureState = createDisclosureState({
    defaultOpen: false,
    onOpenChange: (isOpen) => local.onOpenChange?.(isOpen)
  });
  const context = {
    setAnchorRect
  };
  return createComponent(ContextMenuContext.Provider, {
    value: context,
    get children() {
      return createComponent(MenuRoot, mergeProps({
        get open() {
          return disclosureState.isOpen();
        },
        get onOpenChange() {
          return disclosureState.setIsOpen;
        },
        getAnchorRect: anchorRect
      }, others));
    }
  });
}
function ContextMenuTrigger(props) {
  const rootContext = useMenuRootContext();
  const menuContext = useMenuContext();
  const context = useContextMenuContext();
  const mergedProps = mergeDefaultProps({
    id: rootContext.generateId("trigger")
  }, props);
  const [local, others] = splitProps(mergedProps, ["ref", "style", "disabled", "onContextMenu", "onPointerDown", "onPointerMove", "onPointerCancel", "onPointerUp"]);
  let longPressTimoutId = 0;
  const clearLongPressTimeout = () => {
    window.clearTimeout(longPressTimoutId);
  };
  onCleanup(() => {
    clearLongPressTimeout();
  });
  const onContextMenu = (e) => {
    if (local.disabled) {
      callHandler(e, local.onContextMenu);
      return;
    }
    clearLongPressTimeout();
    e.preventDefault();
    e.stopPropagation();
    context.setAnchorRect({
      x: e.clientX,
      y: e.clientY
    });
    if (menuContext.isOpen()) {
      menuContext.focusContent();
    } else {
      menuContext.open(true);
    }
  };
  const isTouchOrPen = (e) => e.pointerType === "touch" || e.pointerType === "pen";
  const onPointerDown = (e) => {
    callHandler(e, local.onPointerDown);
    if (!local.disabled && isTouchOrPen(e)) {
      clearLongPressTimeout();
      context.setAnchorRect({
        x: e.clientX,
        y: e.clientY
      });
      longPressTimoutId = window.setTimeout(() => menuContext.open(false), 700);
    }
  };
  const onPointerMove = (e) => {
    callHandler(e, local.onPointerMove);
    if (!local.disabled && isTouchOrPen(e)) {
      clearLongPressTimeout();
    }
  };
  const onPointerCancel = (e) => {
    callHandler(e, local.onPointerCancel);
    if (!local.disabled && isTouchOrPen(e)) {
      clearLongPressTimeout();
    }
  };
  const onPointerUp = (e) => {
    callHandler(e, local.onPointerUp);
    if (!local.disabled && isTouchOrPen(e)) {
      clearLongPressTimeout();
    }
  };
  return createComponent(Polymorphic, mergeProps({
    as: "div",
    ref(r$) {
      var _ref$ = mergeRefs(menuContext.setTriggerRef, local.ref);
      typeof _ref$ === "function" && _ref$(r$);
    },
    get style() {
      return combineStyle({
        // prevent iOS context menu from appearing
        "-webkit-touch-callout": "none"
      }, local.style);
    },
    get ["data-disabled"]() {
      return local.disabled ? "" : void 0;
    },
    onContextMenu,
    onPointerDown,
    onPointerMove,
    onPointerCancel,
    onPointerUp
  }, () => menuContext.dataset(), others));
}
var ContextMenu = Object.assign(ContextMenuRoot, {
  Arrow: PopperArrow,
  CheckboxItem: MenuCheckboxItem,
  Content: ContextMenuContent,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  Icon: MenuIcon,
  Item: MenuItem,
  ItemDescription: MenuItemDescription,
  ItemIndicator: MenuItemIndicator,
  ItemLabel: MenuItemLabel,
  Portal: MenuPortal,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  Separator: SeparatorRoot,
  Sub: MenuSub,
  SubContent: MenuSubContent,
  SubTrigger: MenuSubTrigger,
  Trigger: ContextMenuTrigger
});
var callbackWith = (fn, v) => fn.length > 0 ? () => fn(untrack(v)) : fn;
function createLatest(sources, options) {
  let index = 0;
  const memos = sources.map((source, i) => createMemo(() => (index = i, source()), void 0, EQUALS_FALSE_OPTIONS));
  return createMemo(() => memos.map((m) => m())[index], void 0, options);
}
function createWritableMemo(fn, value, options) {
  let combined = () => value;
  const [signal, setSignal] = createSignal(value), memo2 = createMemo(callbackWith(fn, () => combined()), value);
  return [combined = createLatest([signal, memo2], options), (setter) => setSignal(() => typeof setter === "function" ? setter(untrack(combined)) : setter)];
}
function createLazyMemo(calc, value, options) {
  let isReading = false, isStale2 = true;
  const [track, trigger] = createSignal(void 0, EQUALS_FALSE_OPTIONS), memo2 = createMemo((p) => isReading ? calc(p) : (isStale2 = !track(), p), value, EQUALS_FALSE_OPTIONS);
  return () => {
    isReading = true;
    if (isStale2) isStale2 = trigger();
    const v = memo2();
    isReading = false;
    return v;
  };
}
function createDerivedStaticStore(fn, value, options) {
  const o = getOwner(), fnMemo = createMemo(fn, value, options), store = {
    ...untrack(fnMemo)
  }, cache2 = {};
  for (const key in store) Object.defineProperty(store, key, {
    get() {
      let keyMemo = cache2[key];
      if (!keyMemo) {
        if (!getListener()) return fnMemo()[key];
        runWithOwner(o, () => cache2[key] = keyMemo = createMemo(() => fnMemo()[key]));
      }
      return keyMemo();
    },
    enumerable: true
  });
  return store;
}
var NULLED_BOUNDS = {
  top: null,
  left: null,
  bottom: null,
  right: null,
  width: null,
  height: null
};
function getElementBounds(element) {
  if (!element) {
    return {
      ...NULLED_BOUNDS
    };
  }
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    bottom: rect.bottom,
    right: rect.right,
    width: rect.width,
    height: rect.height
  };
}
function createElementBounds(target, {
  trackMutation = true,
  trackResize = true,
  trackScroll = true
} = {}) {
  const isFn = typeof target === "function", [track, trigger] = createSignal(void 0, {
    equals: false
  });
  let calc;
  if (sharedConfig.context) {
    calc = () => NULLED_BOUNDS;
    onMount(() => {
      calc = () => getElementBounds(access$1(target));
      trigger();
    });
  } else if (isFn) {
    calc = () => getElementBounds(target());
    onMount(trigger);
  } else calc = () => getElementBounds(target);
  const bounds = createDerivedStaticStore(() => (track(), calc()));
  if (trackResize) {
    createResizeObserver(isFn ? () => target() || [] : target, typeof trackResize === "function" ? trackResize(trigger) : trigger);
  }
  if (trackScroll) {
    const scrollHandler = isFn ? (e) => {
      const el = target();
      el && e.target instanceof Node && e.target.contains(el) && trigger();
    } : (e) => e.target instanceof Node && e.target.contains(target) && trigger();
    makeEventListener(window, "scroll", typeof trackScroll === "function" ? trackScroll(scrollHandler) : scrollHandler, {
      capture: true
    });
  }
  if (trackMutation) {
    const mo = new MutationObserver(typeof trackMutation === "function" ? trackMutation(trigger) : trigger);
    mo.observe(document.body, {
      attributeFilter: ["style", "class"],
      subtree: true,
      childList: true
    });
    onCleanup(() => mo.disconnect());
  }
  return bounds;
}
var PASSIVE = {
  passive: true
};
var DEFAULT_MOUSE_POSITION = {
  x: 0,
  y: 0,
  isInside: false,
  sourceType: null
};
function makeMousePositionListener(target = window, callback, options = {}) {
  const {
    touch = true,
    followTouch = true
  } = options;
  const [listen, clear] = makeEventListenerStack(target, PASSIVE);
  const handleMouse = (e) => callback({
    x: e.pageX,
    y: e.pageY,
    sourceType: "mouse"
  });
  listen("mousemove", handleMouse);
  listen("dragover", handleMouse);
  if (touch) {
    const handleTouch = (e) => {
      if (e.touches.length) callback({
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        sourceType: "touch"
      });
    };
    listen("touchstart", handleTouch);
    if (followTouch) listen("touchmove", handleTouch);
  }
  return clear;
}
function makeMouseInsideListener(target = window, callback, options = {}) {
  const {
    touch = true
  } = options;
  const [listen, clear] = makeEventListenerStack(target, PASSIVE);
  let mouseIn = false;
  let touchIn = !touch;
  function handleChange(isInside) {
    this === "mouse" ? mouseIn = isInside : touchIn = isInside;
    callback(mouseIn || touchIn);
  }
  listen("mouseover", handleChange.bind("mouse", true));
  listen("mouseout", handleChange.bind("mouse", false));
  listen("mousemove", handleChange.bind("mouse", true), {
    passive: true,
    once: true
  });
  if (touch) {
    listen("touchstart", handleChange.bind("touch", true));
    listen("touchend", handleChange.bind("touch", false));
  }
  return clear;
}
function createMousePosition(target, options = {}) {
  const fallback = {
    ...DEFAULT_MOUSE_POSITION,
    ...options.initialValue
  };
  const [state, setState] = createStaticStore(fallback);
  const attachListeners = (el) => {
    makeMousePositionListener(el, setState, options);
    makeMouseInsideListener(el, setState.bind(void 0, "isInside"), options);
  };
  if (typeof target !== "function") attachListeners(target);
  else createEffect(() => attachListeners(target()));
  return state;
}
/* @__PURE__ */ createHydratableSingletonRoot(createMousePosition.bind(void 0, void 0, void 0));
var Subscribable = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Set();
    this.subscribe = this.subscribe.bind(this);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    this.onSubscribe();
    return () => {
      this.listeners.delete(listener);
      this.onUnsubscribe();
    };
  }
  hasListeners() {
    return this.listeners.size > 0;
  }
  onSubscribe() {
  }
  onUnsubscribe() {
  }
};
var defaultTimeoutProvider = {
  // We need the wrapper function syntax below instead of direct references to
  // global setTimeout etc.
  //
  // BAD: `setTimeout: setTimeout`
  // GOOD: `setTimeout: (cb, delay) => setTimeout(cb, delay)`
  //
  // If we use direct references here, then anything that wants to spy on or
  // replace the global setTimeout (like tests) won't work since we'll already
  // have a hard reference to the original implementation at the time when this
  // file was imported.
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timeoutId) => clearTimeout(timeoutId),
  setInterval: (callback, delay) => setInterval(callback, delay),
  clearInterval: (intervalId) => clearInterval(intervalId)
};
var TimeoutManager = class {
  // We cannot have TimeoutManager<T> as we must instantiate it with a concrete
  // type at app boot; and if we leave that type, then any new timer provider
  // would need to support ReturnType<typeof setTimeout>, which is infeasible.
  //
  // We settle for type safety for the TimeoutProvider type, and accept that
  // this class is unsafe internally to allow for extension.
  #provider = defaultTimeoutProvider;
  #providerCalled = false;
  setTimeoutProvider(provider) {
    this.#provider = provider;
  }
  setTimeout(callback, delay) {
    return this.#provider.setTimeout(callback, delay);
  }
  clearTimeout(timeoutId) {
    this.#provider.clearTimeout(timeoutId);
  }
  setInterval(callback, delay) {
    return this.#provider.setInterval(callback, delay);
  }
  clearInterval(intervalId) {
    this.#provider.clearInterval(intervalId);
  }
};
var timeoutManager = new TimeoutManager();
function systemSetTimeoutZero(callback) {
  setTimeout(callback, 0);
}
var isServer = typeof window === "undefined" || "Deno" in globalThis;
function noop() {
}
function functionalUpdate(updater, input) {
  return typeof updater === "function" ? updater(input) : updater;
}
function isValidTimeout(value) {
  return typeof value === "number" && value >= 0 && value !== Infinity;
}
function timeUntilStale(updatedAt, staleTime) {
  return Math.max(updatedAt + (staleTime || 0) - Date.now(), 0);
}
function resolveStaleTime(staleTime, query) {
  return typeof staleTime === "function" ? staleTime(query) : staleTime;
}
function resolveEnabled(enabled, query) {
  return typeof enabled === "function" ? enabled(query) : enabled;
}
function matchQuery(filters, query) {
  const {
    type = "all",
    exact,
    fetchStatus,
    predicate,
    queryKey,
    stale
  } = filters;
  if (queryKey) {
    if (exact) {
      if (query.queryHash !== hashQueryKeyByOptions(queryKey, query.options)) {
        return false;
      }
    } else if (!partialMatchKey(query.queryKey, queryKey)) {
      return false;
    }
  }
  if (type !== "all") {
    const isActive = query.isActive();
    if (type === "active" && !isActive) {
      return false;
    }
    if (type === "inactive" && isActive) {
      return false;
    }
  }
  if (typeof stale === "boolean" && query.isStale() !== stale) {
    return false;
  }
  if (fetchStatus && fetchStatus !== query.state.fetchStatus) {
    return false;
  }
  if (predicate && !predicate(query)) {
    return false;
  }
  return true;
}
function matchMutation(filters, mutation) {
  const {
    exact,
    status,
    predicate,
    mutationKey
  } = filters;
  if (mutationKey) {
    if (!mutation.options.mutationKey) {
      return false;
    }
    if (exact) {
      if (hashKey(mutation.options.mutationKey) !== hashKey(mutationKey)) {
        return false;
      }
    } else if (!partialMatchKey(mutation.options.mutationKey, mutationKey)) {
      return false;
    }
  }
  if (status && mutation.state.status !== status) {
    return false;
  }
  if (predicate && !predicate(mutation)) {
    return false;
  }
  return true;
}
function hashQueryKeyByOptions(queryKey, options) {
  const hashFn = options?.queryKeyHashFn || hashKey;
  return hashFn(queryKey);
}
function hashKey(queryKey) {
  return JSON.stringify(queryKey, (_, val) => isPlainObject(val) ? Object.keys(val).sort().reduce((result, key) => {
    result[key] = val[key];
    return result;
  }, {}) : val);
}
function partialMatchKey(a, b) {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    return Object.keys(b).every((key) => partialMatchKey(a[key], b[key]));
  }
  return false;
}
var hasOwn = Object.prototype.hasOwnProperty;
function replaceEqualDeep(a, b) {
  if (a === b) {
    return a;
  }
  const array = isPlainArray(a) && isPlainArray(b);
  if (!array && !(isPlainObject(a) && isPlainObject(b))) return b;
  const aItems = array ? a : Object.keys(a);
  const aSize = aItems.length;
  const bItems = array ? b : Object.keys(b);
  const bSize = bItems.length;
  const copy = array ? new Array(bSize) : {};
  let equalItems = 0;
  for (let i = 0; i < bSize; i++) {
    const key = array ? i : bItems[i];
    const aItem = a[key];
    const bItem = b[key];
    if (aItem === bItem) {
      copy[key] = aItem;
      if (array ? i < aSize : hasOwn.call(a, key)) equalItems++;
      continue;
    }
    if (aItem === null || bItem === null || typeof aItem !== "object" || typeof bItem !== "object") {
      copy[key] = bItem;
      continue;
    }
    const v = replaceEqualDeep(aItem, bItem);
    copy[key] = v;
    if (v === aItem) equalItems++;
  }
  return aSize === bSize && equalItems === aSize ? a : copy;
}
function shallowEqualObjects(a, b) {
  if (!b || Object.keys(a).length !== Object.keys(b).length) {
    return false;
  }
  for (const key in a) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}
function isPlainArray(value) {
  return Array.isArray(value) && value.length === Object.keys(value).length;
}
function isPlainObject(o) {
  if (!hasObjectPrototype(o)) {
    return false;
  }
  const ctor = o.constructor;
  if (ctor === void 0) {
    return true;
  }
  const prot = ctor.prototype;
  if (!hasObjectPrototype(prot)) {
    return false;
  }
  if (!prot.hasOwnProperty("isPrototypeOf")) {
    return false;
  }
  if (Object.getPrototypeOf(o) !== Object.prototype) {
    return false;
  }
  return true;
}
function hasObjectPrototype(o) {
  return Object.prototype.toString.call(o) === "[object Object]";
}
function sleep(timeout) {
  return new Promise((resolve) => {
    timeoutManager.setTimeout(resolve, timeout);
  });
}
function replaceData(prevData, data, options) {
  if (typeof options.structuralSharing === "function") {
    return options.structuralSharing(prevData, data);
  } else if (options.structuralSharing !== false) {
    return replaceEqualDeep(prevData, data);
  }
  return data;
}
function keepPreviousData(previousData) {
  return previousData;
}
function addToEnd(items, item, max = 0) {
  const newItems = [...items, item];
  return max && newItems.length > max ? newItems.slice(1) : newItems;
}
function addToStart(items, item, max = 0) {
  const newItems = [item, ...items];
  return max && newItems.length > max ? newItems.slice(0, -1) : newItems;
}
var skipToken = Symbol();
function ensureQueryFn(options, fetchOptions) {
  if (!options.queryFn && fetchOptions?.initialPromise) {
    return () => fetchOptions.initialPromise;
  }
  if (!options.queryFn || options.queryFn === skipToken) {
    return () => Promise.reject(new Error(`Missing queryFn: '${options.queryHash}'`));
  }
  return options.queryFn;
}
function shouldThrowError(throwOnError, params) {
  if (typeof throwOnError === "function") {
    return throwOnError(...params);
  }
  return !!throwOnError;
}
var FocusManager = class extends Subscribable {
  #focused;
  #cleanup;
  #setup;
  constructor() {
    super();
    this.#setup = (onFocus) => {
      if (!isServer && window.addEventListener) {
        const listener = () => onFocus();
        window.addEventListener("visibilitychange", listener, false);
        return () => {
          window.removeEventListener("visibilitychange", listener);
        };
      }
      return;
    };
  }
  onSubscribe() {
    if (!this.#cleanup) {
      this.setEventListener(this.#setup);
    }
  }
  onUnsubscribe() {
    if (!this.hasListeners()) {
      this.#cleanup?.();
      this.#cleanup = void 0;
    }
  }
  setEventListener(setup) {
    this.#setup = setup;
    this.#cleanup?.();
    this.#cleanup = setup((focused) => {
      if (typeof focused === "boolean") {
        this.setFocused(focused);
      } else {
        this.onFocus();
      }
    });
  }
  setFocused(focused) {
    const changed = this.#focused !== focused;
    if (changed) {
      this.#focused = focused;
      this.onFocus();
    }
  }
  onFocus() {
    const isFocused = this.isFocused();
    this.listeners.forEach((listener) => {
      listener(isFocused);
    });
  }
  isFocused() {
    if (typeof this.#focused === "boolean") {
      return this.#focused;
    }
    return globalThis.document?.visibilityState !== "hidden";
  }
};
var focusManager = new FocusManager();
function pendingThenable() {
  let resolve;
  let reject;
  const thenable = new Promise((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  thenable.status = "pending";
  thenable.catch(() => {
  });
  function finalize(data) {
    Object.assign(thenable, data);
    delete thenable.resolve;
    delete thenable.reject;
  }
  thenable.resolve = (value) => {
    finalize({
      status: "fulfilled",
      value
    });
    resolve(value);
  };
  thenable.reject = (reason) => {
    finalize({
      status: "rejected",
      reason
    });
    reject(reason);
  };
  return thenable;
}
function tryResolveSync(promise) {
  let data;
  promise.then((result) => {
    data = result;
    return result;
  }, noop)?.catch(noop);
  if (data !== void 0) {
    return {
      data
    };
  }
  return void 0;
}
function defaultTransformerFn(data) {
  return data;
}
function hydrate(client, dehydratedState, options) {
  if (typeof dehydratedState !== "object" || dehydratedState === null) {
    return;
  }
  const mutationCache = client.getMutationCache();
  const queryCache = client.getQueryCache();
  const deserializeData = client.getDefaultOptions().hydrate?.deserializeData ?? defaultTransformerFn;
  const mutations = dehydratedState.mutations || [];
  const queries = dehydratedState.queries || [];
  mutations.forEach(({
    state,
    ...mutationOptions
  }) => {
    mutationCache.build(client, {
      ...client.getDefaultOptions().hydrate?.mutations,
      ...options?.defaultOptions?.mutations,
      ...mutationOptions
    }, state);
  });
  queries.forEach(({
    queryKey,
    state,
    queryHash,
    meta,
    promise,
    dehydratedAt
  }) => {
    const syncData = promise ? tryResolveSync(promise) : void 0;
    const rawData = state.data === void 0 ? syncData?.data : state.data;
    const data = rawData === void 0 ? rawData : deserializeData(rawData);
    let query = queryCache.get(queryHash);
    const existingQueryIsPending = query?.state.status === "pending";
    const existingQueryIsFetching = query?.state.fetchStatus === "fetching";
    if (query) {
      const hasNewerSyncData = syncData && // We only need this undefined check to handle older dehydration
      // payloads that might not have dehydratedAt
      dehydratedAt !== void 0 && dehydratedAt > query.state.dataUpdatedAt;
      if (state.dataUpdatedAt > query.state.dataUpdatedAt || hasNewerSyncData) {
        const {
          fetchStatus: _ignored,
          ...serializedState
        } = state;
        query.setState({
          ...serializedState,
          data
        });
      }
    } else {
      query = queryCache.build(
        client,
        {
          ...client.getDefaultOptions().hydrate?.queries,
          ...options?.defaultOptions?.queries,
          queryKey,
          queryHash,
          meta
        },
        // Reset fetch status to idle to avoid
        // query being stuck in fetching state upon hydration
        {
          ...state,
          data,
          fetchStatus: "idle",
          status: data !== void 0 ? "success" : state.status
        }
      );
    }
    if (promise && !existingQueryIsPending && !existingQueryIsFetching && // Only hydrate if dehydration is newer than any existing data,
    // this is always true for new queries
    (dehydratedAt === void 0 || dehydratedAt > query.state.dataUpdatedAt)) {
      query.fetch(void 0, {
        // RSC transformed promises are not thenable
        initialPromise: Promise.resolve(promise).then(deserializeData)
      }).catch(noop);
    }
  });
}
var defaultScheduler = systemSetTimeoutZero;
function createNotifyManager() {
  let queue = [];
  let transactions = 0;
  let notifyFn = (callback) => {
    callback();
  };
  let batchNotifyFn = (callback) => {
    callback();
  };
  let scheduleFn = defaultScheduler;
  const schedule = (callback) => {
    if (transactions) {
      queue.push(callback);
    } else {
      scheduleFn(() => {
        notifyFn(callback);
      });
    }
  };
  const flush = () => {
    const originalQueue = queue;
    queue = [];
    if (originalQueue.length) {
      scheduleFn(() => {
        batchNotifyFn(() => {
          originalQueue.forEach((callback) => {
            notifyFn(callback);
          });
        });
      });
    }
  };
  return {
    batch: (callback) => {
      let result;
      transactions++;
      try {
        result = callback();
      } finally {
        transactions--;
        if (!transactions) {
          flush();
        }
      }
      return result;
    },
    /**
     * All calls to the wrapped function will be batched.
     */
    batchCalls: (callback) => {
      return (...args) => {
        schedule(() => {
          callback(...args);
        });
      };
    },
    schedule,
    /**
     * Use this method to set a custom notify function.
     * This can be used to for example wrap notifications with `React.act` while running tests.
     */
    setNotifyFunction: (fn) => {
      notifyFn = fn;
    },
    /**
     * Use this method to set a custom function to batch notifications together into a single tick.
     * By default React Query will use the batch function provided by ReactDOM or React Native.
     */
    setBatchNotifyFunction: (fn) => {
      batchNotifyFn = fn;
    },
    setScheduler: (fn) => {
      scheduleFn = fn;
    }
  };
}
var notifyManager = createNotifyManager();
var OnlineManager = class extends Subscribable {
  #online = true;
  #cleanup;
  #setup;
  constructor() {
    super();
    this.#setup = (onOnline) => {
      if (!isServer && window.addEventListener) {
        const onlineListener = () => onOnline(true);
        const offlineListener = () => onOnline(false);
        window.addEventListener("online", onlineListener, false);
        window.addEventListener("offline", offlineListener, false);
        return () => {
          window.removeEventListener("online", onlineListener);
          window.removeEventListener("offline", offlineListener);
        };
      }
      return;
    };
  }
  onSubscribe() {
    if (!this.#cleanup) {
      this.setEventListener(this.#setup);
    }
  }
  onUnsubscribe() {
    if (!this.hasListeners()) {
      this.#cleanup?.();
      this.#cleanup = void 0;
    }
  }
  setEventListener(setup) {
    this.#setup = setup;
    this.#cleanup?.();
    this.#cleanup = setup(this.setOnline.bind(this));
  }
  setOnline(online) {
    const changed = this.#online !== online;
    if (changed) {
      this.#online = online;
      this.listeners.forEach((listener) => {
        listener(online);
      });
    }
  }
  isOnline() {
    return this.#online;
  }
};
var onlineManager = new OnlineManager();
function defaultRetryDelay(failureCount) {
  return Math.min(1e3 * 2 ** failureCount, 3e4);
}
function canFetch(networkMode) {
  return (networkMode ?? "online") === "online" ? onlineManager.isOnline() : true;
}
var CancelledError = class extends Error {
  constructor(options) {
    super("CancelledError");
    this.revert = options?.revert;
    this.silent = options?.silent;
  }
};
function createRetryer(config) {
  let isRetryCancelled = false;
  let failureCount = 0;
  let continueFn;
  const thenable = pendingThenable();
  const isResolved = () => thenable.status !== "pending";
  const cancel = (cancelOptions) => {
    if (!isResolved()) {
      const error = new CancelledError(cancelOptions);
      reject(error);
      config.onCancel?.(error);
    }
  };
  const cancelRetry = () => {
    isRetryCancelled = true;
  };
  const continueRetry = () => {
    isRetryCancelled = false;
  };
  const canContinue = () => focusManager.isFocused() && (config.networkMode === "always" || onlineManager.isOnline()) && config.canRun();
  const canStart = () => canFetch(config.networkMode) && config.canRun();
  const resolve = (value) => {
    if (!isResolved()) {
      continueFn?.();
      thenable.resolve(value);
    }
  };
  const reject = (value) => {
    if (!isResolved()) {
      continueFn?.();
      thenable.reject(value);
    }
  };
  const pause = () => {
    return new Promise((continueResolve) => {
      continueFn = (value) => {
        if (isResolved() || canContinue()) {
          continueResolve(value);
        }
      };
      config.onPause?.();
    }).then(() => {
      continueFn = void 0;
      if (!isResolved()) {
        config.onContinue?.();
      }
    });
  };
  const run = () => {
    if (isResolved()) {
      return;
    }
    let promiseOrValue;
    const initialPromise = failureCount === 0 ? config.initialPromise : void 0;
    try {
      promiseOrValue = initialPromise ?? config.fn();
    } catch (error) {
      promiseOrValue = Promise.reject(error);
    }
    Promise.resolve(promiseOrValue).then(resolve).catch((error) => {
      if (isResolved()) {
        return;
      }
      const retry = config.retry ?? (isServer ? 0 : 3);
      const retryDelay = config.retryDelay ?? defaultRetryDelay;
      const delay = typeof retryDelay === "function" ? retryDelay(failureCount, error) : retryDelay;
      const shouldRetry = retry === true || typeof retry === "number" && failureCount < retry || typeof retry === "function" && retry(failureCount, error);
      if (isRetryCancelled || !shouldRetry) {
        reject(error);
        return;
      }
      failureCount++;
      config.onFail?.(failureCount, error);
      sleep(delay).then(() => {
        return canContinue() ? void 0 : pause();
      }).then(() => {
        if (isRetryCancelled) {
          reject(error);
        } else {
          run();
        }
      });
    });
  };
  return {
    promise: thenable,
    status: () => thenable.status,
    cancel,
    continue: () => {
      continueFn?.();
      return thenable;
    },
    cancelRetry,
    continueRetry,
    canStart,
    start: () => {
      if (canStart()) {
        run();
      } else {
        pause().then(run);
      }
      return thenable;
    }
  };
}
var Removable = class {
  #gcTimeout;
  destroy() {
    this.clearGcTimeout();
  }
  scheduleGc() {
    this.clearGcTimeout();
    if (isValidTimeout(this.gcTime)) {
      this.#gcTimeout = timeoutManager.setTimeout(() => {
        this.optionalRemove();
      }, this.gcTime);
    }
  }
  updateGcTime(newGcTime) {
    this.gcTime = Math.max(this.gcTime || 0, newGcTime ?? (isServer ? Infinity : 5 * 60 * 1e3));
  }
  clearGcTimeout() {
    if (this.#gcTimeout) {
      timeoutManager.clearTimeout(this.#gcTimeout);
      this.#gcTimeout = void 0;
    }
  }
};
var Query = class extends Removable {
  #initialState;
  #revertState;
  #cache;
  #client;
  #retryer;
  #defaultOptions;
  #abortSignalConsumed;
  constructor(config) {
    super();
    this.#abortSignalConsumed = false;
    this.#defaultOptions = config.defaultOptions;
    this.setOptions(config.options);
    this.observers = [];
    this.#client = config.client;
    this.#cache = this.#client.getQueryCache();
    this.queryKey = config.queryKey;
    this.queryHash = config.queryHash;
    this.#initialState = getDefaultState$1(this.options);
    this.state = config.state ?? this.#initialState;
    this.scheduleGc();
  }
  get meta() {
    return this.options.meta;
  }
  get promise() {
    return this.#retryer?.promise;
  }
  setOptions(options) {
    this.options = {
      ...this.#defaultOptions,
      ...options
    };
    this.updateGcTime(this.options.gcTime);
    if (this.state && this.state.data === void 0) {
      const defaultState = getDefaultState$1(this.options);
      if (defaultState.data !== void 0) {
        this.setState(successState(defaultState.data, defaultState.dataUpdatedAt));
        this.#initialState = defaultState;
      }
    }
  }
  optionalRemove() {
    if (!this.observers.length && this.state.fetchStatus === "idle") {
      this.#cache.remove(this);
    }
  }
  setData(newData, options) {
    const data = replaceData(this.state.data, newData, this.options);
    this.#dispatch({
      data,
      type: "success",
      dataUpdatedAt: options?.updatedAt,
      manual: options?.manual
    });
    return data;
  }
  setState(state, setStateOptions) {
    this.#dispatch({
      type: "setState",
      state,
      setStateOptions
    });
  }
  cancel(options) {
    const promise = this.#retryer?.promise;
    this.#retryer?.cancel(options);
    return promise ? promise.then(noop).catch(noop) : Promise.resolve();
  }
  destroy() {
    super.destroy();
    this.cancel({
      silent: true
    });
  }
  reset() {
    this.destroy();
    this.setState(this.#initialState);
  }
  isActive() {
    return this.observers.some((observer) => resolveEnabled(observer.options.enabled, this) !== false);
  }
  isDisabled() {
    if (this.getObserversCount() > 0) {
      return !this.isActive();
    }
    return this.options.queryFn === skipToken || this.state.dataUpdateCount + this.state.errorUpdateCount === 0;
  }
  isStatic() {
    if (this.getObserversCount() > 0) {
      return this.observers.some((observer) => resolveStaleTime(observer.options.staleTime, this) === "static");
    }
    return false;
  }
  isStale() {
    if (this.getObserversCount() > 0) {
      return this.observers.some((observer) => observer.getCurrentResult().isStale);
    }
    return this.state.data === void 0 || this.state.isInvalidated;
  }
  isStaleByTime(staleTime = 0) {
    if (this.state.data === void 0) {
      return true;
    }
    if (staleTime === "static") {
      return false;
    }
    if (this.state.isInvalidated) {
      return true;
    }
    return !timeUntilStale(this.state.dataUpdatedAt, staleTime);
  }
  onFocus() {
    const observer = this.observers.find((x) => x.shouldFetchOnWindowFocus());
    observer?.refetch({
      cancelRefetch: false
    });
    this.#retryer?.continue();
  }
  onOnline() {
    const observer = this.observers.find((x) => x.shouldFetchOnReconnect());
    observer?.refetch({
      cancelRefetch: false
    });
    this.#retryer?.continue();
  }
  addObserver(observer) {
    if (!this.observers.includes(observer)) {
      this.observers.push(observer);
      this.clearGcTimeout();
      this.#cache.notify({
        type: "observerAdded",
        query: this,
        observer
      });
    }
  }
  removeObserver(observer) {
    if (this.observers.includes(observer)) {
      this.observers = this.observers.filter((x) => x !== observer);
      if (!this.observers.length) {
        if (this.#retryer) {
          if (this.#abortSignalConsumed) {
            this.#retryer.cancel({
              revert: true
            });
          } else {
            this.#retryer.cancelRetry();
          }
        }
        this.scheduleGc();
      }
      this.#cache.notify({
        type: "observerRemoved",
        query: this,
        observer
      });
    }
  }
  getObserversCount() {
    return this.observers.length;
  }
  invalidate() {
    if (!this.state.isInvalidated) {
      this.#dispatch({
        type: "invalidate"
      });
    }
  }
  async fetch(options, fetchOptions) {
    if (this.state.fetchStatus !== "idle" && // If the promise in the retyer is already rejected, we have to definitely
    // re-start the fetch; there is a chance that the query is still in a
    // pending state when that happens
    this.#retryer?.status() !== "rejected") {
      if (this.state.data !== void 0 && fetchOptions?.cancelRefetch) {
        this.cancel({
          silent: true
        });
      } else if (this.#retryer) {
        this.#retryer.continueRetry();
        return this.#retryer.promise;
      }
    }
    if (options) {
      this.setOptions(options);
    }
    if (!this.options.queryFn) {
      const observer = this.observers.find((x) => x.options.queryFn);
      if (observer) {
        this.setOptions(observer.options);
      }
    }
    const abortController = new AbortController();
    const addSignalProperty = (object) => {
      Object.defineProperty(object, "signal", {
        enumerable: true,
        get: () => {
          this.#abortSignalConsumed = true;
          return abortController.signal;
        }
      });
    };
    const fetchFn = () => {
      const queryFn = ensureQueryFn(this.options, fetchOptions);
      const createQueryFnContext = () => {
        const queryFnContext2 = {
          client: this.#client,
          queryKey: this.queryKey,
          meta: this.meta
        };
        addSignalProperty(queryFnContext2);
        return queryFnContext2;
      };
      const queryFnContext = createQueryFnContext();
      this.#abortSignalConsumed = false;
      if (this.options.persister) {
        return this.options.persister(queryFn, queryFnContext, this);
      }
      return queryFn(queryFnContext);
    };
    const createFetchContext = () => {
      const context2 = {
        fetchOptions,
        options: this.options,
        queryKey: this.queryKey,
        client: this.#client,
        state: this.state,
        fetchFn
      };
      addSignalProperty(context2);
      return context2;
    };
    const context = createFetchContext();
    this.options.behavior?.onFetch(context, this);
    this.#revertState = this.state;
    if (this.state.fetchStatus === "idle" || this.state.fetchMeta !== context.fetchOptions?.meta) {
      this.#dispatch({
        type: "fetch",
        meta: context.fetchOptions?.meta
      });
    }
    this.#retryer = createRetryer({
      initialPromise: fetchOptions?.initialPromise,
      fn: context.fetchFn,
      onCancel: (error) => {
        if (error instanceof CancelledError && error.revert) {
          this.setState({
            ...this.#revertState,
            fetchStatus: "idle"
          });
        }
        abortController.abort();
      },
      onFail: (failureCount, error) => {
        this.#dispatch({
          type: "failed",
          failureCount,
          error
        });
      },
      onPause: () => {
        this.#dispatch({
          type: "pause"
        });
      },
      onContinue: () => {
        this.#dispatch({
          type: "continue"
        });
      },
      retry: context.options.retry,
      retryDelay: context.options.retryDelay,
      networkMode: context.options.networkMode,
      canRun: () => true
    });
    try {
      const data = await this.#retryer.start();
      if (data === void 0) {
        if (false) ;
        throw new Error(`${this.queryHash} data is undefined`);
      }
      this.setData(data);
      this.#cache.config.onSuccess?.(data, this);
      this.#cache.config.onSettled?.(data, this.state.error, this);
      return data;
    } catch (error) {
      if (error instanceof CancelledError) {
        if (error.silent) {
          return this.#retryer.promise;
        } else if (error.revert) {
          if (this.state.data === void 0) {
            throw error;
          }
          return this.state.data;
        }
      }
      this.#dispatch({
        type: "error",
        error
      });
      this.#cache.config.onError?.(error, this);
      this.#cache.config.onSettled?.(this.state.data, error, this);
      throw error;
    } finally {
      this.scheduleGc();
    }
  }
  #dispatch(action) {
    const reducer = (state) => {
      switch (action.type) {
        case "failed":
          return {
            ...state,
            fetchFailureCount: action.failureCount,
            fetchFailureReason: action.error
          };
        case "pause":
          return {
            ...state,
            fetchStatus: "paused"
          };
        case "continue":
          return {
            ...state,
            fetchStatus: "fetching"
          };
        case "fetch":
          return {
            ...state,
            ...fetchState(state.data, this.options),
            fetchMeta: action.meta ?? null
          };
        case "success":
          const newState = {
            ...state,
            ...successState(action.data, action.dataUpdatedAt),
            dataUpdateCount: state.dataUpdateCount + 1,
            ...!action.manual && {
              fetchStatus: "idle",
              fetchFailureCount: 0,
              fetchFailureReason: null
            }
          };
          this.#revertState = action.manual ? newState : void 0;
          return newState;
        case "error":
          const error = action.error;
          return {
            ...state,
            error,
            errorUpdateCount: state.errorUpdateCount + 1,
            errorUpdatedAt: Date.now(),
            fetchFailureCount: state.fetchFailureCount + 1,
            fetchFailureReason: error,
            fetchStatus: "idle",
            status: "error"
          };
        case "invalidate":
          return {
            ...state,
            isInvalidated: true
          };
        case "setState":
          return {
            ...state,
            ...action.state
          };
      }
    };
    this.state = reducer(this.state);
    notifyManager.batch(() => {
      this.observers.forEach((observer) => {
        observer.onQueryUpdate();
      });
      this.#cache.notify({
        query: this,
        type: "updated",
        action
      });
    });
  }
};
function fetchState(data, options) {
  return {
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchStatus: canFetch(options.networkMode) ? "fetching" : "paused",
    ...data === void 0 && {
      error: null,
      status: "pending"
    }
  };
}
function successState(data, dataUpdatedAt) {
  return {
    data,
    dataUpdatedAt: dataUpdatedAt ?? Date.now(),
    error: null,
    isInvalidated: false,
    status: "success"
  };
}
function getDefaultState$1(options) {
  const data = typeof options.initialData === "function" ? options.initialData() : options.initialData;
  const hasData = data !== void 0;
  const initialDataUpdatedAt = hasData ? typeof options.initialDataUpdatedAt === "function" ? options.initialDataUpdatedAt() : options.initialDataUpdatedAt : 0;
  return {
    data,
    dataUpdateCount: 0,
    dataUpdatedAt: hasData ? initialDataUpdatedAt ?? Date.now() : 0,
    error: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchMeta: null,
    isInvalidated: false,
    status: hasData ? "success" : "pending",
    fetchStatus: "idle"
  };
}
var QueryObserver = class extends Subscribable {
  constructor(client, options) {
    super();
    this.options = options;
    this.#client = client;
    this.#selectError = null;
    this.#currentThenable = pendingThenable();
    this.bindMethods();
    this.setOptions(options);
  }
  #client;
  #currentQuery = void 0;
  #currentQueryInitialState = void 0;
  #currentResult = void 0;
  #currentResultState;
  #currentResultOptions;
  #currentThenable;
  #selectError;
  #selectFn;
  #selectResult;
  // This property keeps track of the last query with defined data.
  // It will be used to pass the previous data and query to the placeholder function between renders.
  #lastQueryWithDefinedData;
  #staleTimeoutId;
  #refetchIntervalId;
  #currentRefetchInterval;
  #trackedProps = /* @__PURE__ */ new Set();
  bindMethods() {
    this.refetch = this.refetch.bind(this);
  }
  onSubscribe() {
    if (this.listeners.size === 1) {
      this.#currentQuery.addObserver(this);
      if (shouldFetchOnMount(this.#currentQuery, this.options)) {
        this.#executeFetch();
      } else {
        this.updateResult();
      }
      this.#updateTimers();
    }
  }
  onUnsubscribe() {
    if (!this.hasListeners()) {
      this.destroy();
    }
  }
  shouldFetchOnReconnect() {
    return shouldFetchOn(this.#currentQuery, this.options, this.options.refetchOnReconnect);
  }
  shouldFetchOnWindowFocus() {
    return shouldFetchOn(this.#currentQuery, this.options, this.options.refetchOnWindowFocus);
  }
  destroy() {
    this.listeners = /* @__PURE__ */ new Set();
    this.#clearStaleTimeout();
    this.#clearRefetchInterval();
    this.#currentQuery.removeObserver(this);
  }
  setOptions(options) {
    const prevOptions = this.options;
    const prevQuery = this.#currentQuery;
    this.options = this.#client.defaultQueryOptions(options);
    if (this.options.enabled !== void 0 && typeof this.options.enabled !== "boolean" && typeof this.options.enabled !== "function" && typeof resolveEnabled(this.options.enabled, this.#currentQuery) !== "boolean") {
      throw new Error("Expected enabled to be a boolean or a callback that returns a boolean");
    }
    this.#updateQuery();
    this.#currentQuery.setOptions(this.options);
    if (prevOptions._defaulted && !shallowEqualObjects(this.options, prevOptions)) {
      this.#client.getQueryCache().notify({
        type: "observerOptionsUpdated",
        query: this.#currentQuery,
        observer: this
      });
    }
    const mounted = this.hasListeners();
    if (mounted && shouldFetchOptionally(this.#currentQuery, prevQuery, this.options, prevOptions)) {
      this.#executeFetch();
    }
    this.updateResult();
    if (mounted && (this.#currentQuery !== prevQuery || resolveEnabled(this.options.enabled, this.#currentQuery) !== resolveEnabled(prevOptions.enabled, this.#currentQuery) || resolveStaleTime(this.options.staleTime, this.#currentQuery) !== resolveStaleTime(prevOptions.staleTime, this.#currentQuery))) {
      this.#updateStaleTimeout();
    }
    const nextRefetchInterval = this.#computeRefetchInterval();
    if (mounted && (this.#currentQuery !== prevQuery || resolveEnabled(this.options.enabled, this.#currentQuery) !== resolveEnabled(prevOptions.enabled, this.#currentQuery) || nextRefetchInterval !== this.#currentRefetchInterval)) {
      this.#updateRefetchInterval(nextRefetchInterval);
    }
  }
  getOptimisticResult(options) {
    const query = this.#client.getQueryCache().build(this.#client, options);
    const result = this.createResult(query, options);
    if (shouldAssignObserverCurrentProperties(this, result)) {
      this.#currentResult = result;
      this.#currentResultOptions = this.options;
      this.#currentResultState = this.#currentQuery.state;
    }
    return result;
  }
  getCurrentResult() {
    return this.#currentResult;
  }
  trackResult(result, onPropTracked) {
    return new Proxy(result, {
      get: (target, key) => {
        this.trackProp(key);
        onPropTracked?.(key);
        if (key === "promise") {
          this.trackProp("data");
          if (!this.options.experimental_prefetchInRender && this.#currentThenable.status === "pending") {
            this.#currentThenable.reject(new Error("experimental_prefetchInRender feature flag is not enabled"));
          }
        }
        return Reflect.get(target, key);
      }
    });
  }
  trackProp(key) {
    this.#trackedProps.add(key);
  }
  getCurrentQuery() {
    return this.#currentQuery;
  }
  refetch({
    ...options
  } = {}) {
    return this.fetch({
      ...options
    });
  }
  fetchOptimistic(options) {
    const defaultedOptions = this.#client.defaultQueryOptions(options);
    const query = this.#client.getQueryCache().build(this.#client, defaultedOptions);
    return query.fetch().then(() => this.createResult(query, defaultedOptions));
  }
  fetch(fetchOptions) {
    return this.#executeFetch({
      ...fetchOptions,
      cancelRefetch: fetchOptions.cancelRefetch ?? true
    }).then(() => {
      this.updateResult();
      return this.#currentResult;
    });
  }
  #executeFetch(fetchOptions) {
    this.#updateQuery();
    let promise = this.#currentQuery.fetch(this.options, fetchOptions);
    if (!fetchOptions?.throwOnError) {
      promise = promise.catch(noop);
    }
    return promise;
  }
  #updateStaleTimeout() {
    this.#clearStaleTimeout();
    const staleTime = resolveStaleTime(this.options.staleTime, this.#currentQuery);
    if (isServer || this.#currentResult.isStale || !isValidTimeout(staleTime)) {
      return;
    }
    const time = timeUntilStale(this.#currentResult.dataUpdatedAt, staleTime);
    const timeout = time + 1;
    this.#staleTimeoutId = timeoutManager.setTimeout(() => {
      if (!this.#currentResult.isStale) {
        this.updateResult();
      }
    }, timeout);
  }
  #computeRefetchInterval() {
    return (typeof this.options.refetchInterval === "function" ? this.options.refetchInterval(this.#currentQuery) : this.options.refetchInterval) ?? false;
  }
  #updateRefetchInterval(nextInterval) {
    this.#clearRefetchInterval();
    this.#currentRefetchInterval = nextInterval;
    if (isServer || resolveEnabled(this.options.enabled, this.#currentQuery) === false || !isValidTimeout(this.#currentRefetchInterval) || this.#currentRefetchInterval === 0) {
      return;
    }
    this.#refetchIntervalId = timeoutManager.setInterval(() => {
      if (this.options.refetchIntervalInBackground || focusManager.isFocused()) {
        this.#executeFetch();
      }
    }, this.#currentRefetchInterval);
  }
  #updateTimers() {
    this.#updateStaleTimeout();
    this.#updateRefetchInterval(this.#computeRefetchInterval());
  }
  #clearStaleTimeout() {
    if (this.#staleTimeoutId) {
      timeoutManager.clearTimeout(this.#staleTimeoutId);
      this.#staleTimeoutId = void 0;
    }
  }
  #clearRefetchInterval() {
    if (this.#refetchIntervalId) {
      timeoutManager.clearInterval(this.#refetchIntervalId);
      this.#refetchIntervalId = void 0;
    }
  }
  createResult(query, options) {
    const prevQuery = this.#currentQuery;
    const prevOptions = this.options;
    const prevResult = this.#currentResult;
    const prevResultState = this.#currentResultState;
    const prevResultOptions = this.#currentResultOptions;
    const queryChange = query !== prevQuery;
    const queryInitialState = queryChange ? query.state : this.#currentQueryInitialState;
    const {
      state
    } = query;
    let newState = {
      ...state
    };
    let isPlaceholderData = false;
    let data;
    if (options._optimisticResults) {
      const mounted = this.hasListeners();
      const fetchOnMount = !mounted && shouldFetchOnMount(query, options);
      const fetchOptionally = mounted && shouldFetchOptionally(query, prevQuery, options, prevOptions);
      if (fetchOnMount || fetchOptionally) {
        newState = {
          ...newState,
          ...fetchState(state.data, query.options)
        };
      }
      if (options._optimisticResults === "isRestoring") {
        newState.fetchStatus = "idle";
      }
    }
    let {
      error,
      errorUpdatedAt,
      status
    } = newState;
    data = newState.data;
    let skipSelect = false;
    if (options.placeholderData !== void 0 && data === void 0 && status === "pending") {
      let placeholderData;
      if (prevResult?.isPlaceholderData && options.placeholderData === prevResultOptions?.placeholderData) {
        placeholderData = prevResult.data;
        skipSelect = true;
      } else {
        placeholderData = typeof options.placeholderData === "function" ? options.placeholderData(this.#lastQueryWithDefinedData?.state.data, this.#lastQueryWithDefinedData) : options.placeholderData;
      }
      if (placeholderData !== void 0) {
        status = "success";
        data = replaceData(prevResult?.data, placeholderData, options);
        isPlaceholderData = true;
      }
    }
    if (options.select && data !== void 0 && !skipSelect) {
      if (prevResult && data === prevResultState?.data && options.select === this.#selectFn) {
        data = this.#selectResult;
      } else {
        try {
          this.#selectFn = options.select;
          data = options.select(data);
          data = replaceData(prevResult?.data, data, options);
          this.#selectResult = data;
          this.#selectError = null;
        } catch (selectError) {
          this.#selectError = selectError;
        }
      }
    }
    if (this.#selectError) {
      error = this.#selectError;
      data = this.#selectResult;
      errorUpdatedAt = Date.now();
      status = "error";
    }
    const isFetching = newState.fetchStatus === "fetching";
    const isPending = status === "pending";
    const isError = status === "error";
    const isLoading = isPending && isFetching;
    const hasData = data !== void 0;
    const result = {
      status,
      fetchStatus: newState.fetchStatus,
      isPending,
      isSuccess: status === "success",
      isError,
      isInitialLoading: isLoading,
      isLoading,
      data,
      dataUpdatedAt: newState.dataUpdatedAt,
      error,
      errorUpdatedAt,
      failureCount: newState.fetchFailureCount,
      failureReason: newState.fetchFailureReason,
      errorUpdateCount: newState.errorUpdateCount,
      isFetched: newState.dataUpdateCount > 0 || newState.errorUpdateCount > 0,
      isFetchedAfterMount: newState.dataUpdateCount > queryInitialState.dataUpdateCount || newState.errorUpdateCount > queryInitialState.errorUpdateCount,
      isFetching,
      isRefetching: isFetching && !isPending,
      isLoadingError: isError && !hasData,
      isPaused: newState.fetchStatus === "paused",
      isPlaceholderData,
      isRefetchError: isError && hasData,
      isStale: isStale(query, options),
      refetch: this.refetch,
      promise: this.#currentThenable,
      isEnabled: resolveEnabled(options.enabled, query) !== false
    };
    const nextResult = result;
    if (this.options.experimental_prefetchInRender) {
      const finalizeThenableIfPossible = (thenable) => {
        if (nextResult.status === "error") {
          thenable.reject(nextResult.error);
        } else if (nextResult.data !== void 0) {
          thenable.resolve(nextResult.data);
        }
      };
      const recreateThenable = () => {
        const pending = this.#currentThenable = nextResult.promise = pendingThenable();
        finalizeThenableIfPossible(pending);
      };
      const prevThenable = this.#currentThenable;
      switch (prevThenable.status) {
        case "pending":
          if (query.queryHash === prevQuery.queryHash) {
            finalizeThenableIfPossible(prevThenable);
          }
          break;
        case "fulfilled":
          if (nextResult.status === "error" || nextResult.data !== prevThenable.value) {
            recreateThenable();
          }
          break;
        case "rejected":
          if (nextResult.status !== "error" || nextResult.error !== prevThenable.reason) {
            recreateThenable();
          }
          break;
      }
    }
    return nextResult;
  }
  updateResult() {
    const prevResult = this.#currentResult;
    const nextResult = this.createResult(this.#currentQuery, this.options);
    this.#currentResultState = this.#currentQuery.state;
    this.#currentResultOptions = this.options;
    if (this.#currentResultState.data !== void 0) {
      this.#lastQueryWithDefinedData = this.#currentQuery;
    }
    if (shallowEqualObjects(nextResult, prevResult)) {
      return;
    }
    this.#currentResult = nextResult;
    const shouldNotifyListeners = () => {
      if (!prevResult) {
        return true;
      }
      const {
        notifyOnChangeProps
      } = this.options;
      const notifyOnChangePropsValue = typeof notifyOnChangeProps === "function" ? notifyOnChangeProps() : notifyOnChangeProps;
      if (notifyOnChangePropsValue === "all" || !notifyOnChangePropsValue && !this.#trackedProps.size) {
        return true;
      }
      const includedProps = new Set(notifyOnChangePropsValue ?? this.#trackedProps);
      if (this.options.throwOnError) {
        includedProps.add("error");
      }
      return Object.keys(this.#currentResult).some((key) => {
        const typedKey = key;
        const changed = this.#currentResult[typedKey] !== prevResult[typedKey];
        return changed && includedProps.has(typedKey);
      });
    };
    this.#notify({
      listeners: shouldNotifyListeners()
    });
  }
  #updateQuery() {
    const query = this.#client.getQueryCache().build(this.#client, this.options);
    if (query === this.#currentQuery) {
      return;
    }
    const prevQuery = this.#currentQuery;
    this.#currentQuery = query;
    this.#currentQueryInitialState = query.state;
    if (this.hasListeners()) {
      prevQuery?.removeObserver(this);
      query.addObserver(this);
    }
  }
  onQueryUpdate() {
    this.updateResult();
    if (this.hasListeners()) {
      this.#updateTimers();
    }
  }
  #notify(notifyOptions) {
    notifyManager.batch(() => {
      if (notifyOptions.listeners) {
        this.listeners.forEach((listener) => {
          listener(this.#currentResult);
        });
      }
      this.#client.getQueryCache().notify({
        query: this.#currentQuery,
        type: "observerResultsUpdated"
      });
    });
  }
};
function shouldLoadOnMount(query, options) {
  return resolveEnabled(options.enabled, query) !== false && query.state.data === void 0 && !(query.state.status === "error" && options.retryOnMount === false);
}
function shouldFetchOnMount(query, options) {
  return shouldLoadOnMount(query, options) || query.state.data !== void 0 && shouldFetchOn(query, options, options.refetchOnMount);
}
function shouldFetchOn(query, options, field) {
  if (resolveEnabled(options.enabled, query) !== false && resolveStaleTime(options.staleTime, query) !== "static") {
    const value = typeof field === "function" ? field(query) : field;
    return value === "always" || value !== false && isStale(query, options);
  }
  return false;
}
function shouldFetchOptionally(query, prevQuery, options, prevOptions) {
  return (query !== prevQuery || resolveEnabled(prevOptions.enabled, query) === false) && (!options.suspense || query.state.status !== "error") && isStale(query, options);
}
function isStale(query, options) {
  return resolveEnabled(options.enabled, query) !== false && query.isStaleByTime(resolveStaleTime(options.staleTime, query));
}
function shouldAssignObserverCurrentProperties(observer, optimisticResult) {
  if (!shallowEqualObjects(observer.getCurrentResult(), optimisticResult)) {
    return true;
  }
  return false;
}
function infiniteQueryBehavior(pages) {
  return {
    onFetch: (context, query) => {
      const options = context.options;
      const direction = context.fetchOptions?.meta?.fetchMore?.direction;
      const oldPages = context.state.data?.pages || [];
      const oldPageParams = context.state.data?.pageParams || [];
      let result = {
        pages: [],
        pageParams: []
      };
      let currentPage = 0;
      const fetchFn = async () => {
        let cancelled = false;
        const addSignalProperty = (object) => {
          Object.defineProperty(object, "signal", {
            enumerable: true,
            get: () => {
              if (context.signal.aborted) {
                cancelled = true;
              } else {
                context.signal.addEventListener("abort", () => {
                  cancelled = true;
                });
              }
              return context.signal;
            }
          });
        };
        const queryFn = ensureQueryFn(context.options, context.fetchOptions);
        const fetchPage = async (data, param, previous) => {
          if (cancelled) {
            return Promise.reject();
          }
          if (param == null && data.pages.length) {
            return Promise.resolve(data);
          }
          const createQueryFnContext = () => {
            const queryFnContext2 = {
              client: context.client,
              queryKey: context.queryKey,
              pageParam: param,
              direction: previous ? "backward" : "forward",
              meta: context.options.meta
            };
            addSignalProperty(queryFnContext2);
            return queryFnContext2;
          };
          const queryFnContext = createQueryFnContext();
          const page = await queryFn(queryFnContext);
          const {
            maxPages
          } = context.options;
          const addTo = previous ? addToStart : addToEnd;
          return {
            pages: addTo(data.pages, page, maxPages),
            pageParams: addTo(data.pageParams, param, maxPages)
          };
        };
        if (direction && oldPages.length) {
          const previous = direction === "backward";
          const pageParamFn = previous ? getPreviousPageParam : getNextPageParam;
          const oldData = {
            pages: oldPages,
            pageParams: oldPageParams
          };
          const param = pageParamFn(options, oldData);
          result = await fetchPage(oldData, param, previous);
        } else {
          const remainingPages = pages ?? oldPages.length;
          do {
            const param = currentPage === 0 ? oldPageParams[0] ?? options.initialPageParam : getNextPageParam(options, result);
            if (currentPage > 0 && param == null) {
              break;
            }
            result = await fetchPage(result, param);
            currentPage++;
          } while (currentPage < remainingPages);
        }
        return result;
      };
      if (context.options.persister) {
        context.fetchFn = () => {
          return context.options.persister?.(fetchFn, {
            client: context.client,
            queryKey: context.queryKey,
            meta: context.options.meta,
            signal: context.signal
          }, query);
        };
      } else {
        context.fetchFn = fetchFn;
      }
    }
  };
}
function getNextPageParam(options, {
  pages,
  pageParams
}) {
  const lastIndex = pages.length - 1;
  return pages.length > 0 ? options.getNextPageParam(pages[lastIndex], pages, pageParams[lastIndex], pageParams) : void 0;
}
function getPreviousPageParam(options, {
  pages,
  pageParams
}) {
  return pages.length > 0 ? options.getPreviousPageParam?.(pages[0], pages, pageParams[0], pageParams) : void 0;
}
var Mutation = class extends Removable {
  #client;
  #observers;
  #mutationCache;
  #retryer;
  constructor(config) {
    super();
    this.#client = config.client;
    this.mutationId = config.mutationId;
    this.#mutationCache = config.mutationCache;
    this.#observers = [];
    this.state = config.state || getDefaultState();
    this.setOptions(config.options);
    this.scheduleGc();
  }
  setOptions(options) {
    this.options = options;
    this.updateGcTime(this.options.gcTime);
  }
  get meta() {
    return this.options.meta;
  }
  addObserver(observer) {
    if (!this.#observers.includes(observer)) {
      this.#observers.push(observer);
      this.clearGcTimeout();
      this.#mutationCache.notify({
        type: "observerAdded",
        mutation: this,
        observer
      });
    }
  }
  removeObserver(observer) {
    this.#observers = this.#observers.filter((x) => x !== observer);
    this.scheduleGc();
    this.#mutationCache.notify({
      type: "observerRemoved",
      mutation: this,
      observer
    });
  }
  optionalRemove() {
    if (!this.#observers.length) {
      if (this.state.status === "pending") {
        this.scheduleGc();
      } else {
        this.#mutationCache.remove(this);
      }
    }
  }
  continue() {
    return this.#retryer?.continue() ?? // continuing a mutation assumes that variables are set, mutation must have been dehydrated before
    this.execute(this.state.variables);
  }
  async execute(variables) {
    const onContinue = () => {
      this.#dispatch({
        type: "continue"
      });
    };
    const mutationFnContext = {
      client: this.#client,
      meta: this.options.meta,
      mutationKey: this.options.mutationKey
    };
    this.#retryer = createRetryer({
      fn: () => {
        if (!this.options.mutationFn) {
          return Promise.reject(new Error("No mutationFn found"));
        }
        return this.options.mutationFn(variables, mutationFnContext);
      },
      onFail: (failureCount, error) => {
        this.#dispatch({
          type: "failed",
          failureCount,
          error
        });
      },
      onPause: () => {
        this.#dispatch({
          type: "pause"
        });
      },
      onContinue,
      retry: this.options.retry ?? 0,
      retryDelay: this.options.retryDelay,
      networkMode: this.options.networkMode,
      canRun: () => this.#mutationCache.canRun(this)
    });
    const restored = this.state.status === "pending";
    const isPaused = !this.#retryer.canStart();
    try {
      if (restored) {
        onContinue();
      } else {
        this.#dispatch({
          type: "pending",
          variables,
          isPaused
        });
        await this.#mutationCache.config.onMutate?.(variables, this, mutationFnContext);
        const context = await this.options.onMutate?.(variables, mutationFnContext);
        if (context !== this.state.context) {
          this.#dispatch({
            type: "pending",
            context,
            variables,
            isPaused
          });
        }
      }
      const data = await this.#retryer.start();
      await this.#mutationCache.config.onSuccess?.(data, variables, this.state.context, this, mutationFnContext);
      await this.options.onSuccess?.(data, variables, this.state.context, mutationFnContext);
      await this.#mutationCache.config.onSettled?.(data, null, this.state.variables, this.state.context, this, mutationFnContext);
      await this.options.onSettled?.(data, null, variables, this.state.context, mutationFnContext);
      this.#dispatch({
        type: "success",
        data
      });
      return data;
    } catch (error) {
      try {
        await this.#mutationCache.config.onError?.(error, variables, this.state.context, this, mutationFnContext);
        await this.options.onError?.(error, variables, this.state.context, mutationFnContext);
        await this.#mutationCache.config.onSettled?.(void 0, error, this.state.variables, this.state.context, this, mutationFnContext);
        await this.options.onSettled?.(void 0, error, variables, this.state.context, mutationFnContext);
        throw error;
      } finally {
        this.#dispatch({
          type: "error",
          error
        });
      }
    } finally {
      this.#mutationCache.runNext(this);
    }
  }
  #dispatch(action) {
    const reducer = (state) => {
      switch (action.type) {
        case "failed":
          return {
            ...state,
            failureCount: action.failureCount,
            failureReason: action.error
          };
        case "pause":
          return {
            ...state,
            isPaused: true
          };
        case "continue":
          return {
            ...state,
            isPaused: false
          };
        case "pending":
          return {
            ...state,
            context: action.context,
            data: void 0,
            failureCount: 0,
            failureReason: null,
            error: null,
            isPaused: action.isPaused,
            status: "pending",
            variables: action.variables,
            submittedAt: Date.now()
          };
        case "success":
          return {
            ...state,
            data: action.data,
            failureCount: 0,
            failureReason: null,
            error: null,
            status: "success",
            isPaused: false
          };
        case "error":
          return {
            ...state,
            data: void 0,
            error: action.error,
            failureCount: state.failureCount + 1,
            failureReason: action.error,
            isPaused: false,
            status: "error"
          };
      }
    };
    this.state = reducer(this.state);
    notifyManager.batch(() => {
      this.#observers.forEach((observer) => {
        observer.onMutationUpdate(action);
      });
      this.#mutationCache.notify({
        mutation: this,
        type: "updated",
        action
      });
    });
  }
};
function getDefaultState() {
  return {
    context: void 0,
    data: void 0,
    error: null,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    status: "idle",
    variables: void 0,
    submittedAt: 0
  };
}
var MutationCache = class extends Subscribable {
  constructor(config = {}) {
    super();
    this.config = config;
    this.#mutations = /* @__PURE__ */ new Set();
    this.#scopes = /* @__PURE__ */ new Map();
    this.#mutationId = 0;
  }
  #mutations;
  #scopes;
  #mutationId;
  build(client, options, state) {
    const mutation = new Mutation({
      client,
      mutationCache: this,
      mutationId: ++this.#mutationId,
      options: client.defaultMutationOptions(options),
      state
    });
    this.add(mutation);
    return mutation;
  }
  add(mutation) {
    this.#mutations.add(mutation);
    const scope = scopeFor(mutation);
    if (typeof scope === "string") {
      const scopedMutations = this.#scopes.get(scope);
      if (scopedMutations) {
        scopedMutations.push(mutation);
      } else {
        this.#scopes.set(scope, [mutation]);
      }
    }
    this.notify({
      type: "added",
      mutation
    });
  }
  remove(mutation) {
    if (this.#mutations.delete(mutation)) {
      const scope = scopeFor(mutation);
      if (typeof scope === "string") {
        const scopedMutations = this.#scopes.get(scope);
        if (scopedMutations) {
          if (scopedMutations.length > 1) {
            const index = scopedMutations.indexOf(mutation);
            if (index !== -1) {
              scopedMutations.splice(index, 1);
            }
          } else if (scopedMutations[0] === mutation) {
            this.#scopes.delete(scope);
          }
        }
      }
    }
    this.notify({
      type: "removed",
      mutation
    });
  }
  canRun(mutation) {
    const scope = scopeFor(mutation);
    if (typeof scope === "string") {
      const mutationsWithSameScope = this.#scopes.get(scope);
      const firstPendingMutation = mutationsWithSameScope?.find((m) => m.state.status === "pending");
      return !firstPendingMutation || firstPendingMutation === mutation;
    } else {
      return true;
    }
  }
  runNext(mutation) {
    const scope = scopeFor(mutation);
    if (typeof scope === "string") {
      const foundMutation = this.#scopes.get(scope)?.find((m) => m !== mutation && m.state.isPaused);
      return foundMutation?.continue() ?? Promise.resolve();
    } else {
      return Promise.resolve();
    }
  }
  clear() {
    notifyManager.batch(() => {
      this.#mutations.forEach((mutation) => {
        this.notify({
          type: "removed",
          mutation
        });
      });
      this.#mutations.clear();
      this.#scopes.clear();
    });
  }
  getAll() {
    return Array.from(this.#mutations);
  }
  find(filters) {
    const defaultedFilters = {
      exact: true,
      ...filters
    };
    return this.getAll().find((mutation) => matchMutation(defaultedFilters, mutation));
  }
  findAll(filters = {}) {
    return this.getAll().filter((mutation) => matchMutation(filters, mutation));
  }
  notify(event) {
    notifyManager.batch(() => {
      this.listeners.forEach((listener) => {
        listener(event);
      });
    });
  }
  resumePausedMutations() {
    const pausedMutations = this.getAll().filter((x) => x.state.isPaused);
    return notifyManager.batch(() => Promise.all(pausedMutations.map((mutation) => mutation.continue().catch(noop))));
  }
};
function scopeFor(mutation) {
  return mutation.options.scope?.id;
}
var MutationObserver$1 = class MutationObserver2 extends Subscribable {
  #client;
  #currentResult = void 0;
  #currentMutation;
  #mutateOptions;
  constructor(client, options) {
    super();
    this.#client = client;
    this.setOptions(options);
    this.bindMethods();
    this.#updateResult();
  }
  bindMethods() {
    this.mutate = this.mutate.bind(this);
    this.reset = this.reset.bind(this);
  }
  setOptions(options) {
    const prevOptions = this.options;
    this.options = this.#client.defaultMutationOptions(options);
    if (!shallowEqualObjects(this.options, prevOptions)) {
      this.#client.getMutationCache().notify({
        type: "observerOptionsUpdated",
        mutation: this.#currentMutation,
        observer: this
      });
    }
    if (prevOptions?.mutationKey && this.options.mutationKey && hashKey(prevOptions.mutationKey) !== hashKey(this.options.mutationKey)) {
      this.reset();
    } else if (this.#currentMutation?.state.status === "pending") {
      this.#currentMutation.setOptions(this.options);
    }
  }
  onUnsubscribe() {
    if (!this.hasListeners()) {
      this.#currentMutation?.removeObserver(this);
    }
  }
  onMutationUpdate(action) {
    this.#updateResult();
    this.#notify(action);
  }
  getCurrentResult() {
    return this.#currentResult;
  }
  reset() {
    this.#currentMutation?.removeObserver(this);
    this.#currentMutation = void 0;
    this.#updateResult();
    this.#notify();
  }
  mutate(variables, options) {
    this.#mutateOptions = options;
    this.#currentMutation?.removeObserver(this);
    this.#currentMutation = this.#client.getMutationCache().build(this.#client, this.options);
    this.#currentMutation.addObserver(this);
    return this.#currentMutation.execute(variables);
  }
  #updateResult() {
    const state = this.#currentMutation?.state ?? getDefaultState();
    this.#currentResult = {
      ...state,
      isPending: state.status === "pending",
      isSuccess: state.status === "success",
      isError: state.status === "error",
      isIdle: state.status === "idle",
      mutate: this.mutate,
      reset: this.reset
    };
  }
  #notify(action) {
    notifyManager.batch(() => {
      if (this.#mutateOptions && this.hasListeners()) {
        const variables = this.#currentResult.variables;
        const onMutateResult = this.#currentResult.context;
        const context = {
          client: this.#client,
          meta: this.options.meta,
          mutationKey: this.options.mutationKey
        };
        if (action?.type === "success") {
          this.#mutateOptions.onSuccess?.(action.data, variables, onMutateResult, context);
          this.#mutateOptions.onSettled?.(action.data, null, variables, onMutateResult, context);
        } else if (action?.type === "error") {
          this.#mutateOptions.onError?.(action.error, variables, onMutateResult, context);
          this.#mutateOptions.onSettled?.(void 0, action.error, variables, onMutateResult, context);
        }
      }
      this.listeners.forEach((listener) => {
        listener(this.#currentResult);
      });
    });
  }
};
var QueryCache = class extends Subscribable {
  constructor(config = {}) {
    super();
    this.config = config;
    this.#queries = /* @__PURE__ */ new Map();
  }
  #queries;
  build(client, options, state) {
    const queryKey = options.queryKey;
    const queryHash = options.queryHash ?? hashQueryKeyByOptions(queryKey, options);
    let query = this.get(queryHash);
    if (!query) {
      query = new Query({
        client,
        queryKey,
        queryHash,
        options: client.defaultQueryOptions(options),
        state,
        defaultOptions: client.getQueryDefaults(queryKey)
      });
      this.add(query);
    }
    return query;
  }
  add(query) {
    if (!this.#queries.has(query.queryHash)) {
      this.#queries.set(query.queryHash, query);
      this.notify({
        type: "added",
        query
      });
    }
  }
  remove(query) {
    const queryInMap = this.#queries.get(query.queryHash);
    if (queryInMap) {
      query.destroy();
      if (queryInMap === query) {
        this.#queries.delete(query.queryHash);
      }
      this.notify({
        type: "removed",
        query
      });
    }
  }
  clear() {
    notifyManager.batch(() => {
      this.getAll().forEach((query) => {
        this.remove(query);
      });
    });
  }
  get(queryHash) {
    return this.#queries.get(queryHash);
  }
  getAll() {
    return [...this.#queries.values()];
  }
  find(filters) {
    const defaultedFilters = {
      exact: true,
      ...filters
    };
    return this.getAll().find((query) => matchQuery(defaultedFilters, query));
  }
  findAll(filters = {}) {
    const queries = this.getAll();
    return Object.keys(filters).length > 0 ? queries.filter((query) => matchQuery(filters, query)) : queries;
  }
  notify(event) {
    notifyManager.batch(() => {
      this.listeners.forEach((listener) => {
        listener(event);
      });
    });
  }
  onFocus() {
    notifyManager.batch(() => {
      this.getAll().forEach((query) => {
        query.onFocus();
      });
    });
  }
  onOnline() {
    notifyManager.batch(() => {
      this.getAll().forEach((query) => {
        query.onOnline();
      });
    });
  }
};
var QueryClient$1 = class QueryClient {
  #queryCache;
  #mutationCache;
  #defaultOptions;
  #queryDefaults;
  #mutationDefaults;
  #mountCount;
  #unsubscribeFocus;
  #unsubscribeOnline;
  constructor(config = {}) {
    this.#queryCache = config.queryCache || new QueryCache();
    this.#mutationCache = config.mutationCache || new MutationCache();
    this.#defaultOptions = config.defaultOptions || {};
    this.#queryDefaults = /* @__PURE__ */ new Map();
    this.#mutationDefaults = /* @__PURE__ */ new Map();
    this.#mountCount = 0;
  }
  mount() {
    this.#mountCount++;
    if (this.#mountCount !== 1) return;
    this.#unsubscribeFocus = focusManager.subscribe(async (focused) => {
      if (focused) {
        await this.resumePausedMutations();
        this.#queryCache.onFocus();
      }
    });
    this.#unsubscribeOnline = onlineManager.subscribe(async (online) => {
      if (online) {
        await this.resumePausedMutations();
        this.#queryCache.onOnline();
      }
    });
  }
  unmount() {
    this.#mountCount--;
    if (this.#mountCount !== 0) return;
    this.#unsubscribeFocus?.();
    this.#unsubscribeFocus = void 0;
    this.#unsubscribeOnline?.();
    this.#unsubscribeOnline = void 0;
  }
  isFetching(filters) {
    return this.#queryCache.findAll({
      ...filters,
      fetchStatus: "fetching"
    }).length;
  }
  isMutating(filters) {
    return this.#mutationCache.findAll({
      ...filters,
      status: "pending"
    }).length;
  }
  /**
   * Imperative (non-reactive) way to retrieve data for a QueryKey.
   * Should only be used in callbacks or functions where reading the latest data is necessary, e.g. for optimistic updates.
   *
   * Hint: Do not use this function inside a component, because it won't receive updates.
   * Use `useQuery` to create a `QueryObserver` that subscribes to changes.
   */
  getQueryData(queryKey) {
    const options = this.defaultQueryOptions({
      queryKey
    });
    return this.#queryCache.get(options.queryHash)?.state.data;
  }
  ensureQueryData(options) {
    const defaultedOptions = this.defaultQueryOptions(options);
    const query = this.#queryCache.build(this, defaultedOptions);
    const cachedData = query.state.data;
    if (cachedData === void 0) {
      return this.fetchQuery(options);
    }
    if (options.revalidateIfStale && query.isStaleByTime(resolveStaleTime(defaultedOptions.staleTime, query))) {
      void this.prefetchQuery(defaultedOptions);
    }
    return Promise.resolve(cachedData);
  }
  getQueriesData(filters) {
    return this.#queryCache.findAll(filters).map(({
      queryKey,
      state
    }) => {
      const data = state.data;
      return [queryKey, data];
    });
  }
  setQueryData(queryKey, updater, options) {
    const defaultedOptions = this.defaultQueryOptions({
      queryKey
    });
    const query = this.#queryCache.get(defaultedOptions.queryHash);
    const prevData = query?.state.data;
    const data = functionalUpdate(updater, prevData);
    if (data === void 0) {
      return void 0;
    }
    return this.#queryCache.build(this, defaultedOptions).setData(data, {
      ...options,
      manual: true
    });
  }
  setQueriesData(filters, updater, options) {
    return notifyManager.batch(() => this.#queryCache.findAll(filters).map(({
      queryKey
    }) => [queryKey, this.setQueryData(queryKey, updater, options)]));
  }
  getQueryState(queryKey) {
    const options = this.defaultQueryOptions({
      queryKey
    });
    return this.#queryCache.get(options.queryHash)?.state;
  }
  removeQueries(filters) {
    const queryCache = this.#queryCache;
    notifyManager.batch(() => {
      queryCache.findAll(filters).forEach((query) => {
        queryCache.remove(query);
      });
    });
  }
  resetQueries(filters, options) {
    const queryCache = this.#queryCache;
    return notifyManager.batch(() => {
      queryCache.findAll(filters).forEach((query) => {
        query.reset();
      });
      return this.refetchQueries({
        type: "active",
        ...filters
      }, options);
    });
  }
  cancelQueries(filters, cancelOptions = {}) {
    const defaultedCancelOptions = {
      revert: true,
      ...cancelOptions
    };
    const promises = notifyManager.batch(() => this.#queryCache.findAll(filters).map((query) => query.cancel(defaultedCancelOptions)));
    return Promise.all(promises).then(noop).catch(noop);
  }
  invalidateQueries(filters, options = {}) {
    return notifyManager.batch(() => {
      this.#queryCache.findAll(filters).forEach((query) => {
        query.invalidate();
      });
      if (filters?.refetchType === "none") {
        return Promise.resolve();
      }
      return this.refetchQueries({
        ...filters,
        type: filters?.refetchType ?? filters?.type ?? "active"
      }, options);
    });
  }
  refetchQueries(filters, options = {}) {
    const fetchOptions = {
      ...options,
      cancelRefetch: options.cancelRefetch ?? true
    };
    const promises = notifyManager.batch(() => this.#queryCache.findAll(filters).filter((query) => !query.isDisabled() && !query.isStatic()).map((query) => {
      let promise = query.fetch(void 0, fetchOptions);
      if (!fetchOptions.throwOnError) {
        promise = promise.catch(noop);
      }
      return query.state.fetchStatus === "paused" ? Promise.resolve() : promise;
    }));
    return Promise.all(promises).then(noop);
  }
  fetchQuery(options) {
    const defaultedOptions = this.defaultQueryOptions(options);
    if (defaultedOptions.retry === void 0) {
      defaultedOptions.retry = false;
    }
    const query = this.#queryCache.build(this, defaultedOptions);
    return query.isStaleByTime(resolveStaleTime(defaultedOptions.staleTime, query)) ? query.fetch(defaultedOptions) : Promise.resolve(query.state.data);
  }
  prefetchQuery(options) {
    return this.fetchQuery(options).then(noop).catch(noop);
  }
  fetchInfiniteQuery(options) {
    options.behavior = infiniteQueryBehavior(options.pages);
    return this.fetchQuery(options);
  }
  prefetchInfiniteQuery(options) {
    return this.fetchInfiniteQuery(options).then(noop).catch(noop);
  }
  ensureInfiniteQueryData(options) {
    options.behavior = infiniteQueryBehavior(options.pages);
    return this.ensureQueryData(options);
  }
  resumePausedMutations() {
    if (onlineManager.isOnline()) {
      return this.#mutationCache.resumePausedMutations();
    }
    return Promise.resolve();
  }
  getQueryCache() {
    return this.#queryCache;
  }
  getMutationCache() {
    return this.#mutationCache;
  }
  getDefaultOptions() {
    return this.#defaultOptions;
  }
  setDefaultOptions(options) {
    this.#defaultOptions = options;
  }
  setQueryDefaults(queryKey, options) {
    this.#queryDefaults.set(hashKey(queryKey), {
      queryKey,
      defaultOptions: options
    });
  }
  getQueryDefaults(queryKey) {
    const defaults = [...this.#queryDefaults.values()];
    const result = {};
    defaults.forEach((queryDefault) => {
      if (partialMatchKey(queryKey, queryDefault.queryKey)) {
        Object.assign(result, queryDefault.defaultOptions);
      }
    });
    return result;
  }
  setMutationDefaults(mutationKey, options) {
    this.#mutationDefaults.set(hashKey(mutationKey), {
      mutationKey,
      defaultOptions: options
    });
  }
  getMutationDefaults(mutationKey) {
    const defaults = [...this.#mutationDefaults.values()];
    const result = {};
    defaults.forEach((queryDefault) => {
      if (partialMatchKey(mutationKey, queryDefault.mutationKey)) {
        Object.assign(result, queryDefault.defaultOptions);
      }
    });
    return result;
  }
  defaultQueryOptions(options) {
    if (options._defaulted) {
      return options;
    }
    const defaultedOptions = {
      ...this.#defaultOptions.queries,
      ...this.getQueryDefaults(options.queryKey),
      ...options,
      _defaulted: true
    };
    if (!defaultedOptions.queryHash) {
      defaultedOptions.queryHash = hashQueryKeyByOptions(defaultedOptions.queryKey, defaultedOptions);
    }
    if (defaultedOptions.refetchOnReconnect === void 0) {
      defaultedOptions.refetchOnReconnect = defaultedOptions.networkMode !== "always";
    }
    if (defaultedOptions.throwOnError === void 0) {
      defaultedOptions.throwOnError = !!defaultedOptions.suspense;
    }
    if (!defaultedOptions.networkMode && defaultedOptions.persister) {
      defaultedOptions.networkMode = "offlineFirst";
    }
    if (defaultedOptions.queryFn === skipToken) {
      defaultedOptions.enabled = false;
    }
    return defaultedOptions;
  }
  defaultMutationOptions(options) {
    if (options?._defaulted) {
      return options;
    }
    return {
      ...this.#defaultOptions.mutations,
      ...options?.mutationKey && this.getMutationDefaults(options.mutationKey),
      ...options,
      _defaulted: true
    };
  }
  clear() {
    this.#queryCache.clear();
    this.#mutationCache.clear();
  }
};
var QueryClientContext = createContext(void 0);
var useQueryClient = (queryClient) => {
  if (queryClient) {
    return queryClient;
  }
  const client = useContext(QueryClientContext);
  if (!client) {
    throw new Error("No QueryClient set, use QueryClientProvider to set one");
  }
  return client();
};
var QueryClientProvider = (props) => {
  createRenderEffect((unmount) => {
    unmount?.();
    props.client.mount();
    return props.client.unmount.bind(props.client);
  });
  onCleanup(() => props.client.unmount());
  return createComponent(QueryClientContext.Provider, {
    value: () => props.client,
    get children() {
      return props.children;
    }
  });
};
var IsRestoringContext = createContext(() => false);
var useIsRestoring = () => useContext(IsRestoringContext);
IsRestoringContext.Provider;
function reconcileFn(store, result, reconcileOption, queryHash) {
  if (reconcileOption === false) return result;
  if (typeof reconcileOption === "function") {
    const newData2 = reconcileOption(store.data, result.data);
    return {
      ...result,
      data: newData2
    };
  }
  let data = result.data;
  if (store.data === void 0) {
    try {
      data = structuredClone(data);
    } catch (error) {
    }
  }
  const newData = reconcile(data, {
    key: reconcileOption
  })(store.data);
  return {
    ...result,
    data: newData
  };
}
var hydratableObserverResult = (query, result) => {
  return result;
};
function useBaseQuery(options, Observer, queryClient) {
  const client = createMemo(() => useQueryClient(queryClient?.()));
  const isRestoring = useIsRestoring();
  const defaultedOptions = createMemo(() => {
    const defaultOptions = client().defaultQueryOptions(options());
    defaultOptions._optimisticResults = isRestoring() ? "isRestoring" : "optimistic";
    defaultOptions.structuralSharing = false;
    return defaultOptions;
  });
  const initialOptions = defaultedOptions();
  const [observer, setObserver] = createSignal(new Observer(client(), defaultedOptions()));
  let observerResult = observer().getOptimisticResult(defaultedOptions());
  const [state, setState] = createStore(observerResult);
  const createClientSubscriber = () => {
    const obs = observer();
    return obs.subscribe((result) => {
      observerResult = result;
      queueMicrotask(() => {
        if (unsubscribe) {
          refetch();
        }
      });
    });
  };
  function setStateWithReconciliation(res) {
    const opts = observer().options;
    const reconcileOptions = opts.reconcile;
    setState((store) => {
      return reconcileFn(store, res, reconcileOptions === void 0 ? false : reconcileOptions, opts.queryHash);
    });
  }
  function createDeepSignal() {
    return [() => state, (v) => {
      const unwrapped = unwrap(state);
      if (typeof v === "function") {
        v = v(unwrapped);
      }
      if (v?.hydrationData) {
        const {
          hydrationData,
          ...rest
        } = v;
        v = rest;
      }
      setStateWithReconciliation(v);
    }];
  }
  let unsubscribe = null;
  let resolver = null;
  const [queryResource, {
    refetch
  }] = createResource(() => {
    const obs = observer();
    return new Promise((resolve, reject) => {
      resolver = resolve;
      if (!unsubscribe && !isRestoring()) {
        unsubscribe = createClientSubscriber();
      }
      obs.updateResult();
      if (observerResult.isError && !observerResult.isFetching && !isRestoring() && shouldThrowError(obs.options.throwOnError, [observerResult.error, obs.getCurrentQuery()])) {
        setStateWithReconciliation(observerResult);
        return reject(observerResult.error);
      }
      if (!observerResult.isLoading) {
        resolver = null;
        return resolve(hydratableObserverResult(obs.getCurrentQuery(), observerResult));
      }
      setStateWithReconciliation(observerResult);
    });
  }, {
    storage: createDeepSignal,
    get deferStream() {
      return options().deferStream;
    },
    /**
     * If this resource was populated on the server (either sync render, or streamed in over time), onHydrated
     * will be called. This is the point at which we can hydrate the query cache state, and setup the query subscriber.
     *
     * Leveraging onHydrated allows us to plug into the async and streaming support that solidjs resources already support.
     *
     * Note that this is only invoked on the client, for queries that were originally run on the server.
     */
    onHydrated(_k, info) {
      if (info.value && "hydrationData" in info.value) {
        hydrate(client(), {
          // @ts-expect-error - hydrationData is not correctly typed internally
          queries: [{
            ...info.value.hydrationData
          }]
        });
      }
      if (unsubscribe) return;
      const newOptions = {
        ...initialOptions
      };
      if ((initialOptions.staleTime || !initialOptions.initialData) && info.value) {
        newOptions.refetchOnMount = false;
      }
      observer().setOptions(newOptions);
      setStateWithReconciliation(observer().getOptimisticResult(newOptions));
      unsubscribe = createClientSubscriber();
    }
  });
  createComputed(on(client, (c) => {
    if (unsubscribe) {
      unsubscribe();
    }
    const newObserver = new Observer(c, defaultedOptions());
    unsubscribe = createClientSubscriber();
    setObserver(newObserver);
  }, {
    defer: true
  }));
  createComputed(on(isRestoring, (restoring) => {
    if (!restoring && !isServer$1) {
      refetch();
    }
  }, {
    defer: true
  }));
  onCleanup(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (resolver && !isServer$1) {
      resolver(observerResult);
      resolver = null;
    }
  });
  createComputed(on([observer, defaultedOptions], ([obs, opts]) => {
    obs.setOptions(opts);
    setStateWithReconciliation(obs.getOptimisticResult(opts));
    refetch();
  }, {
    defer: true
  }));
  const handler = {
    get(target, prop) {
      if (prop === "data") {
        if (state.data !== void 0) {
          return queryResource.latest?.data;
        }
        return queryResource()?.data;
      }
      return Reflect.get(target, prop);
    }
  };
  return new Proxy(state, handler);
}
function useQuery(options, queryClient) {
  return useBaseQuery(createMemo(() => options()), QueryObserver, queryClient);
}
function useMutation(options, queryClient) {
  const client = createMemo(() => useQueryClient(queryClient?.()));
  const observer = new MutationObserver$1(client(), options());
  const mutate = (variables, mutateOptions) => {
    observer.mutate(variables, mutateOptions).catch(noop);
  };
  const [state, setState] = createStore({
    ...observer.getCurrentResult(),
    mutate,
    mutateAsync: observer.getCurrentResult().mutate
  });
  createComputed(() => {
    observer.setOptions(options());
  });
  createComputed(on(() => state.status, () => {
    if (state.isError && shouldThrowError(observer.options.throwOnError, [state.error])) {
      throw state.error;
    }
  }));
  const unsubscribe = observer.subscribe((result) => {
    setState({
      ...result,
      mutate,
      mutateAsync: result.mutate
    });
  });
  onCleanup(unsubscribe);
  return state;
}
var QueryClient2 = class extends QueryClient$1 {
  constructor(config = {}) {
    super(config);
  }
};
function queryOptions(options) {
  return options;
}
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var addClearMethod = (storage) => {
  if (typeof storage.clear === "function") {
    return storage;
  }
  storage.clear = () => {
    let key;
    while (key = storage.key(0)) {
      storage.removeItem(key);
    }
  };
  return storage;
};
var cookiePropertyKeys = ["domain", "expires", "path", "secure", "httpOnly", "maxAge", "sameSite"];
function serializeCookieOptions(options) {
  if (!options) {
    return "";
  }
  let memo2 = "";
  for (const key in options) {
    if (!cookiePropertyKeys.includes(key)) continue;
    const value = options[key];
    memo2 += value instanceof Date ? `; ${key}=${value.toUTCString()}` : typeof value === "boolean" ? `; ${key}` : `; ${key}=${value}`;
  }
  return memo2;
}
function deserializeCookieOptions(cookie, key) {
  return cookie.match(`(^|;)\\s*${key}\\s*=\\s*([^;]+)`)?.pop() ?? null;
}
var useRequest;
try {
  useRequest = __require("solid-start/server").useRequest;
} catch (e) {
  useRequest = () => {
    console.warn("It seems you attempt to use cookieStorage on the server without having solid-start installed or use vite.");
    return {
      request: {
        headers: {
          get: () => ""
        }
      }
    };
  };
}
var cookieStorage = addClearMethod({
  _read: () => document.cookie,
  _write: (key, value, options) => {
    document.cookie = `${key}=${value}${serializeCookieOptions(options)}`;
  },
  getItem: (key, options) => deserializeCookieOptions(cookieStorage._read(options), key),
  setItem: (key, value, options) => {
    const oldValue = null;
    cookieStorage._write(key, value, options);
    {
      const storageEvent = Object.assign(new Event("storage"), {
        key,
        oldValue,
        newValue: value,
        url: globalThis.document.URL,
        storageArea: cookieStorage
      });
      window.dispatchEvent(storageEvent);
    }
  },
  removeItem: (key, options) => {
    cookieStorage._write(key, "deleted", {
      ...options,
      expires: /* @__PURE__ */ new Date(0)
    });
  },
  key: (index, options) => {
    let key = null;
    let count = 0;
    cookieStorage._read(options).replace(/(?:^|;)\s*(.+?)\s*=\s*[^;]+/g, (_, found) => {
      if (!key && found && count++ === index) {
        key = found;
      }
      return "";
    });
    return key;
  },
  getLength: (options) => {
    let length = 0;
    cookieStorage._read(options).replace(/(?:^|;)\s*.+?\s*=\s*[^;]+/g, (found) => {
      length += found ? 1 : 0;
      return "";
    });
    return length;
  },
  get length() {
    return this.getLength();
  }
});
function makePersisted(signal, options = {}) {
  const storage = options.storage || globalThis.localStorage;
  if (!storage) {
    return signal;
  }
  const storageOptions = options.storageOptions;
  const name = options.name || `storage-${createUniqueId()}`;
  const serialize = options.serialize || JSON.stringify.bind(JSON);
  const deserialize = options.deserialize || JSON.parse.bind(JSON);
  const init = storage.getItem(name, storageOptions);
  const set = typeof signal[0] === "function" ? (data) => signal[1](() => deserialize(data)) : (data) => signal[1](reconcile(deserialize(data)));
  let unchanged = true;
  if (init instanceof Promise) init.then((data) => unchanged && data && set(data));
  else if (init) set(init);
  return [signal[0], typeof signal[0] === "function" ? (value) => {
    const output = signal[1](value);
    if (value) storage.setItem(name, serialize(output), storageOptions);
    else storage.removeItem(name, storageOptions);
    unchanged = false;
    return output;
  } : (...args) => {
    signal[1](...args);
    const value = serialize(untrack(() => signal[0]));
    storage.setItem(name, value, storageOptions);
    unchanged = false;
  }];
}
var _tmpl$$1 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=currentColor d="M10.5 16.3q-.2 0-.35-.137T10 15.8V8.2q0-.225.15-.362t.35-.138q.05 0 .35.15l3.625 3.625q.125.125.175.25t.05.275t-.05.275t-.175.25L10.85 16.15q-.075.075-.162.113t-.188.037">`);
const IconMaterialSymbolsArrowRightRounded = (props = {}) => (() => {
  var _el$ = getNextElement(_tmpl$$1);
  spread(_el$, props, true, true);
  runHydrationEvents();
  return _el$;
})();
function createContextProvider(factoryFn, defaults) {
  const ctx = createContext(defaults);
  return [(props) => {
    return createComponent(ctx.Provider, {
      value: factoryFn(props),
      get children() {
        return props.children;
      }
    });
  }, () => useContext(ctx)];
}
var _tmpl$ = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=currentColor d="M16 12a2 2 0 0 1 2-2a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2m-6 0a2 2 0 0 1 2-2a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2m-6 0a2 2 0 0 1 2-2a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2">`);
const IconMdiDotsHorizontal = (props = {}) => (() => {
  var _el$ = getNextElement(_tmpl$);
  spread(_el$, props, true, true);
  runHydrationEvents();
  return _el$;
})();
export {
  ReactiveWeakMap as A,
  context_menu_exports as B,
  ContextMenu as C,
  FormControlLabel as F,
  IconBiX as I,
  Listbox as L,
  Popover as P,
  QueryClient2 as Q,
  ReactiveMap as R,
  Select as S,
  TriggerCache as T,
  IconMaterialSymbolsArrowRightRounded as a,
  createElementBounds as b,
  createContextProvider as c,
  IconMdiDotsHorizontal as d,
  IconTablerChevronRight as e,
  createWritableMemo as f,
  createMousePosition as g,
  useQuery as h,
  isMobile as i,
  QueryClientProvider as j,
  keepPreviousData as k,
  createResizeObserver as l,
  makePersisted as m,
  FormControlErrorMessage as n,
  FormControlDescription as o,
  FORM_CONTROL_PROP_NAMES as p,
  queryOptions as q,
  createFormControl as r,
  createFormResetListener as s,
  FormControlContext as t,
  useMutation as u,
  useFormControlContext as v,
  FORM_CONTROL_FIELD_PROP_NAMES as w,
  createFormControlField as x,
  createLazyMemo as y,
  select_exports as z
};
