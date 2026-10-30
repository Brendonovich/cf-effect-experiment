import { m as memo, P as Portal, g as getNextElement, t as template, i as insert } from "./web-BrXyZ-Hv.js";
import { i as splitProps, b as createComponent, m as mergeProps, q as createUniqueId, e as createSignal, p as createContext, r as useContext, t as createEffect, f as onCleanup, S as Show } from "./solid-COykZtSy.js";
import { c as cn } from "./button-BRzb2Wkz.js";
import { m as mergeRefs, B as ButtonRoot, d as mergeDefaultProps, e as createDisclosureState, s as src_default, f as createRegisterId, g as createGenerateId, h as callHandler, i as createHideOutside, j as src_default$1, k as createFocusScope, l as DismissableLayer, P as Polymorphic, n as combineStyle, o as contains, _ as __export, p as focusWithoutScrolling } from "./ZUHR2BAH-DeUuezxO.js";
var dialog_exports = {};
__export(dialog_exports, {
  CloseButton: () => DialogCloseButton$1,
  Content: () => DialogContent$1,
  Description: () => DialogDescription,
  Dialog: () => Dialog$1,
  Overlay: () => DialogOverlay$1,
  Portal: () => DialogPortal$1,
  Root: () => DialogRoot,
  Title: () => DialogTitle$1,
  Trigger: () => DialogTrigger$1
});
var DialogContext = createContext();
function useDialogContext() {
  const context = useContext(DialogContext);
  if (context === void 0) {
    throw new Error("[kobalte]: `useDialogContext` must be used within a `Dialog` component");
  }
  return context;
}
function DialogCloseButton$1(props) {
  const context = useDialogContext();
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
  }, others));
}
function DialogContent$1(props) {
  let ref;
  const context = useDialogContext();
  const mergedProps = mergeDefaultProps({
    id: context.generateId("content")
  }, props);
  const [local, others] = splitProps(mergedProps, ["ref", "onOpenAutoFocus", "onCloseAutoFocus", "onPointerDownOutside", "onFocusOutside", "onInteractOutside"]);
  let hasInteractedOutside = false;
  let hasPointerDownOutside = false;
  const onPointerDownOutside = (e) => {
    local.onPointerDownOutside?.(e);
    if (context.modal() && e.detail.isContextMenu) {
      e.preventDefault();
    }
  };
  const onFocusOutside = (e) => {
    local.onFocusOutside?.(e);
    if (context.modal()) {
      e.preventDefault();
    }
  };
  const onInteractOutside = (e) => {
    local.onInteractOutside?.(e);
    if (context.modal()) {
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
  const onCloseAutoFocus = (e) => {
    local.onCloseAutoFocus?.(e);
    if (context.modal()) {
      e.preventDefault();
      focusWithoutScrolling(context.triggerRef());
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
  createHideOutside({
    isDisabled: () => !(context.isOpen() && context.modal()),
    targets: () => ref ? [ref] : []
  });
  src_default$1({
    element: () => ref ?? null,
    enabled: () => context.contentPresent() && context.preventScroll()
  });
  createFocusScope({
    trapFocus: () => context.isOpen() && context.modal(),
    onMountAutoFocus: local.onOpenAutoFocus,
    onUnmountAutoFocus: onCloseAutoFocus
  }, () => ref);
  createEffect(() => onCleanup(context.registerContentId(others.id)));
  return createComponent(Show, {
    get when() {
      return context.contentPresent();
    },
    get children() {
      return createComponent(DismissableLayer, mergeProps({
        ref(r$) {
          var _ref$ = mergeRefs((el) => {
            context.setContentRef(el);
            ref = el;
          }, local.ref);
          typeof _ref$ === "function" && _ref$(r$);
        },
        role: "dialog",
        tabIndex: -1,
        get disableOutsidePointerEvents() {
          return memo(() => !!context.modal())() && context.isOpen();
        },
        get excludedElements() {
          return [context.triggerRef];
        },
        get ["aria-labelledby"]() {
          return context.titleId();
        },
        get ["aria-describedby"]() {
          return context.descriptionId();
        },
        get ["data-expanded"]() {
          return context.isOpen() ? "" : void 0;
        },
        get ["data-closed"]() {
          return !context.isOpen() ? "" : void 0;
        },
        onPointerDownOutside,
        onFocusOutside,
        onInteractOutside,
        get onDismiss() {
          return context.close;
        }
      }, others));
    }
  });
}
function DialogDescription(props) {
  const context = useDialogContext();
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
  }, others));
}
function DialogOverlay$1(props) {
  const context = useDialogContext();
  const [local, others] = splitProps(props, ["ref", "style", "onPointerDown"]);
  const onPointerDown = (e) => {
    callHandler(e, local.onPointerDown);
    if (e.target === e.currentTarget) {
      e.preventDefault();
    }
  };
  return createComponent(Show, {
    get when() {
      return context.overlayPresent();
    },
    get children() {
      return createComponent(Polymorphic, mergeProps({
        as: "div",
        ref(r$) {
          var _ref$2 = mergeRefs(context.setOverlayRef, local.ref);
          typeof _ref$2 === "function" && _ref$2(r$);
        },
        get style() {
          return combineStyle({
            "pointer-events": "auto"
          }, local.style);
        },
        get ["data-expanded"]() {
          return context.isOpen() ? "" : void 0;
        },
        get ["data-closed"]() {
          return !context.isOpen() ? "" : void 0;
        },
        onPointerDown
      }, others));
    }
  });
}
function DialogPortal$1(props) {
  const context = useDialogContext();
  return createComponent(Show, {
    get when() {
      return context.contentPresent() || context.overlayPresent();
    },
    get children() {
      return createComponent(Portal, props);
    }
  });
}
var DIALOG_INTL_TRANSLATIONS = {
  // `aria-label` of Dialog.CloseButton.
  dismiss: "Dismiss"
};
function DialogRoot(props) {
  const defaultId = `dialog-${createUniqueId()}`;
  const mergedProps = mergeDefaultProps({
    id: defaultId,
    modal: true,
    translations: DIALOG_INTL_TRANSLATIONS
  }, props);
  const [contentId, setContentId] = createSignal();
  const [titleId, setTitleId] = createSignal();
  const [descriptionId, setDescriptionId] = createSignal();
  const [overlayRef, setOverlayRef] = createSignal();
  const [contentRef, setContentRef] = createSignal();
  const [triggerRef, setTriggerRef] = createSignal();
  const disclosureState = createDisclosureState({
    open: () => mergedProps.open,
    defaultOpen: () => mergedProps.defaultOpen,
    onOpenChange: (isOpen) => mergedProps.onOpenChange?.(isOpen)
  });
  const shouldMount = () => mergedProps.forceMount || disclosureState.isOpen();
  const {
    present: overlayPresent
  } = src_default({
    show: shouldMount,
    element: () => overlayRef() ?? null
  });
  const {
    present: contentPresent
  } = src_default({
    show: shouldMount,
    element: () => contentRef() ?? null
  });
  const context = {
    translations: () => mergedProps.translations ?? DIALOG_INTL_TRANSLATIONS,
    isOpen: disclosureState.isOpen,
    modal: () => mergedProps.modal ?? true,
    preventScroll: () => mergedProps.preventScroll ?? context.modal(),
    contentId,
    titleId,
    descriptionId,
    triggerRef,
    overlayRef,
    setOverlayRef,
    contentRef,
    setContentRef,
    overlayPresent,
    contentPresent,
    close: disclosureState.close,
    toggle: disclosureState.toggle,
    setTriggerRef,
    generateId: createGenerateId(() => mergedProps.id),
    registerContentId: createRegisterId(setContentId),
    registerTitleId: createRegisterId(setTitleId),
    registerDescriptionId: createRegisterId(setDescriptionId)
  };
  return createComponent(DialogContext.Provider, {
    value: context,
    get children() {
      return mergedProps.children;
    }
  });
}
function DialogTitle$1(props) {
  const context = useDialogContext();
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
  }, others));
}
function DialogTrigger$1(props) {
  const context = useDialogContext();
  const [local, others] = splitProps(props, ["ref", "onClick"]);
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
    get ["data-expanded"]() {
      return context.isOpen() ? "" : void 0;
    },
    get ["data-closed"]() {
      return !context.isOpen() ? "" : void 0;
    },
    onClick
  }, others));
}
var Dialog$1 = Object.assign(DialogRoot, {
  CloseButton: DialogCloseButton$1,
  Content: DialogContent$1,
  Description: DialogDescription,
  Overlay: DialogOverlay$1,
  Portal: DialogPortal$1,
  Title: DialogTitle$1,
  Trigger: DialogTrigger$1
});
var _tmpl$ = /* @__PURE__ */ template(`<div class="fixed inset-0 z-50 flex items-start justify-center sm:items-center">`), _tmpl$2 = /* @__PURE__ */ template(`<svg aria-hidden=true xmlns=http://www.w3.org/2000/svg viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round class=size-4><path d="M18 6l-12 12"></path><path d="M6 6l12 12">`), _tmpl$3 = /* @__PURE__ */ template(`<span class=sr-only>Close`);
const Dialog = DialogRoot;
const DialogTrigger = DialogTrigger$1;
const DialogPortal = (props) => {
  const [, rest] = splitProps(props, ["children"]);
  return createComponent(DialogPortal$1, mergeProps(rest, {
    get children() {
      var _el$ = getNextElement(_tmpl$);
      insert(_el$, () => props.children);
      return _el$;
    }
  }));
};
const DialogOverlay = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return createComponent(DialogOverlay$1, mergeProps({
    get ["class"]() {
      return cn("fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0", props.class);
    }
  }, rest));
};
const DialogContent = (props) => {
  const [, rest] = splitProps(props, ["class", "children"]);
  return createComponent(DialogPortal, {
    get children() {
      return [createComponent(DialogOverlay, {}), createComponent(DialogContent$1, mergeProps({
        get ["class"]() {
          return cn("fixed z-50 grid border bg-background shadow-lg duration-200 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95 sm:rounded-lg", props.class);
        }
      }, rest, {
        get children() {
          return props.children;
        }
      }))];
    }
  });
};
function DialogCloseButton() {
  return createComponent(DialogCloseButton$1, {
    "class": "rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[expanded]:bg-accent data-[expanded]:text-muted-foreground",
    get children() {
      return [getNextElement(_tmpl$2), getNextElement(_tmpl$3)];
    }
  });
}
const DialogTitle = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return createComponent(DialogTitle$1, mergeProps({
    get ["class"]() {
      return cn("text-lg font-semibold leading-none tracking-tight", props.class);
    }
  }, rest));
};
export {
  DialogTrigger as D,
  DialogContent as a,
  Dialog as b,
  DialogTitle as c,
  DialogCloseButton as d,
  Dialog$1 as e
};
