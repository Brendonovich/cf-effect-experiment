import { d as delegateEvents, g as getNextElement, t as template, i as insert, u as use, c as setAttribute, f as className, h as style, b as runHydrationEvents, a as getNextMarker, j as addEventListener, m as memo } from "./web-BrXyZ-Hv.js";
import { m as mergeProps, e as createSignal, k as onMount, f as onCleanup, t as createEffect, o as on, b as createComponent, F as For, j as createRenderEffect, S as Show } from "./solid-COykZtSy.js";
import { c as createStore, p as produce, r as reconcile } from "./store-12zX8qse.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class=sonner-loading-wrapper><div class=sonner-spinner>`), _tmpl$2 = /* @__PURE__ */ template(`<div class=sonner-loading-bar>`), _tmpl$3 = /* @__PURE__ */ template(`<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 20 20"fill=currentColor height=20 width=20><path fill-rule=evenodd d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"clip-rule=evenodd>`), _tmpl$4 = /* @__PURE__ */ template(`<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 24 24"fill=currentColor height=20 width=20><path fill-rule=evenodd d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"clip-rule=evenodd>`), _tmpl$5 = /* @__PURE__ */ template(`<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 20 20"fill=currentColor height=20 width=20><path fill-rule=evenodd d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"clip-rule=evenodd>`), _tmpl$6 = /* @__PURE__ */ template(`<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 20 20"fill=currentColor height=20 width=20><path fill-rule=evenodd d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"clip-rule=evenodd>`), _tmpl$7 = /* @__PURE__ */ template(`<div class=sonner-loader>`), _tmpl$8 = /* @__PURE__ */ template(`<button aria-label="Close toast"data-close-button><svg xmlns=http://www.w3.org/2000/svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.5 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18>`), _tmpl$9 = /* @__PURE__ */ template(`<li aria-atomic=true role=status tabindex=0 data-sonner-toast><!$><!/><!$><!/>`), _tmpl$0 = /* @__PURE__ */ template(`<div data-icon><!$><!/><!$><!/>`), _tmpl$1 = /* @__PURE__ */ template(`<div data-description>`), _tmpl$10 = /* @__PURE__ */ template(`<div data-content><div data-title></div><!$><!/>`), _tmpl$11 = /* @__PURE__ */ template(`<button data-button data-cancel>`), _tmpl$12 = /* @__PURE__ */ template(`<button data-button>`), _tmpl$13 = /* @__PURE__ */ template(`<section tabindex=-1>`), _tmpl$14 = /* @__PURE__ */ template(`<ol tabindex=-1 data-sonner-toaster>`);
function styleInject(css, {
  insertAt
} = {}) {
  if (typeof document === "undefined") return;
  const head = document.head || document.getElementsByTagName("head")[0];
  const style2 = document.createElement("style");
  style2.type = "text/css";
  if (insertAt === "top") {
    if (head.firstChild) {
      head.insertBefore(style2, head.firstChild);
    } else {
      head.appendChild(style2);
    }
  } else {
    head.appendChild(style2);
  }
  if (style2.styleSheet) {
    style2.styleSheet.cssText = css;
  } else {
    style2.appendChild(document.createTextNode(css));
  }
}
styleInject(':where(html[dir=ltr]),\n:where([data-sonner-toaster][dir=ltr]) {\n  --toast-icon-margin-start: -3px;\n  --toast-icon-margin-end: 4px;\n  --toast-svg-margin-start: -1px;\n  --toast-svg-margin-end: 0px;\n  --toast-button-margin-start: auto;\n  --toast-button-margin-end: 0;\n  --toast-close-button-start: 0;\n  --toast-close-button-end: unset;\n  --toast-close-button-transform: translate(-35%, -35%);\n}\n:where(html[dir=rtl]),\n:where([data-sonner-toaster][dir=rtl]) {\n  --toast-icon-margin-start: 4px;\n  --toast-icon-margin-end: -3px;\n  --toast-svg-margin-start: 0px;\n  --toast-svg-margin-end: -1px;\n  --toast-button-margin-start: 0;\n  --toast-button-margin-end: auto;\n  --toast-close-button-start: unset;\n  --toast-close-button-end: 0;\n  --toast-close-button-transform: translate(35%, -35%);\n}\n:where([data-sonner-toaster]) {\n  position: fixed;\n  width: var(--width);\n  font-family:\n    ui-sans-serif,\n    system-ui,\n    -apple-system,\n    BlinkMacSystemFont,\n    Segoe UI,\n    Roboto,\n    Helvetica Neue,\n    Arial,\n    Noto Sans,\n    sans-serif,\n    Apple Color Emoji,\n    Segoe UI Emoji,\n    Segoe UI Symbol,\n    Noto Color Emoji;\n  --gray1: hsl(0, 0%, 99%);\n  --gray2: hsl(0, 0%, 97.3%);\n  --gray3: hsl(0, 0%, 95.1%);\n  --gray4: hsl(0, 0%, 93%);\n  --gray5: hsl(0, 0%, 90.9%);\n  --gray6: hsl(0, 0%, 88.7%);\n  --gray7: hsl(0, 0%, 85.8%);\n  --gray8: hsl(0, 0%, 78%);\n  --gray9: hsl(0, 0%, 56.1%);\n  --gray10: hsl(0, 0%, 52.3%);\n  --gray11: hsl(0, 0%, 43.5%);\n  --gray12: hsl(0, 0%, 9%);\n  --border-radius: 8px;\n  box-sizing: border-box;\n  padding: 0;\n  margin: 0;\n  list-style: none;\n  outline: none;\n  z-index: 999999999;\n}\n:where([data-sonner-toaster][data-x-position=right]) {\n  right: max(var(--offset), env(safe-area-inset-right));\n}\n:where([data-sonner-toaster][data-x-position=left]) {\n  left: max(var(--offset), env(safe-area-inset-left));\n}\n:where([data-sonner-toaster][data-x-position=center]) {\n  left: 50%;\n  transform: translateX(-50%);\n}\n:where([data-sonner-toaster][data-y-position=top]) {\n  top: max(var(--offset), env(safe-area-inset-top));\n}\n:where([data-sonner-toaster][data-y-position=bottom]) {\n  bottom: max(var(--offset), env(safe-area-inset-bottom));\n}\n:where([data-sonner-toast]) {\n  --y: translateY(100%);\n  --lift-amount: calc(var(--lift) * var(--gap));\n  z-index: var(--z-index);\n  position: absolute;\n  opacity: 0;\n  transform: var(--y);\n  filter: blur(0);\n  touch-action: none;\n  transition:\n    transform 400ms,\n    opacity 400ms,\n    height 400ms,\n    box-shadow 200ms;\n  box-sizing: border-box;\n  outline: none;\n  overflow-wrap: anywhere;\n}\n:where([data-sonner-toast][data-styled=true]) {\n  padding: 16px;\n  background: var(--normal-bg);\n  border: 1px solid var(--normal-border);\n  color: var(--normal-text);\n  border-radius: var(--border-radius);\n  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1);\n  width: var(--width);\n  font-size: 13px;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n:where([data-sonner-toast]:focus-visible) {\n  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 2px rgba(0, 0, 0, 0.2);\n}\n:where([data-sonner-toast][data-y-position=top]) {\n  top: 0;\n  --y: translateY(-100%);\n  --lift: 1;\n  --lift-amount: calc(1 * var(--gap));\n}\n:where([data-sonner-toast][data-y-position=bottom]) {\n  bottom: 0;\n  --y: translateY(100%);\n  --lift: -1;\n  --lift-amount: calc(var(--lift) * var(--gap));\n}\n:where([data-sonner-toast]) :where([data-description]) {\n  font-weight: 400;\n  line-height: 1.4;\n  color: inherit;\n}\n:where([data-sonner-toast]) :where([data-title]) {\n  font-weight: 500;\n  line-height: 1.5;\n  color: inherit;\n}\n:where([data-sonner-toast]) :where([data-icon]) {\n  display: flex;\n  height: 16px;\n  width: 16px;\n  position: relative;\n  justify-content: flex-start;\n  align-items: center;\n  flex-shrink: 0;\n  margin-left: var(--toast-icon-margin-start);\n  margin-right: var(--toast-icon-margin-end);\n}\n:where([data-sonner-toast][data-promise=true]) :where([data-icon]) > svg {\n  opacity: 0;\n  transform: scale(0.8);\n  transform-origin: center;\n  animation: sonner-fade-in 300ms ease forwards;\n}\n:where([data-sonner-toast]) :where([data-icon]) > * {\n  flex-shrink: 0;\n}\n:where([data-sonner-toast]) :where([data-icon]) svg {\n  margin-left: var(--toast-svg-margin-start);\n  margin-right: var(--toast-svg-margin-end);\n}\n:where([data-sonner-toast]) :where([data-content]) {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n[data-sonner-toast][data-styled=true] [data-button] {\n  border-radius: 4px;\n  padding-left: 8px;\n  padding-right: 8px;\n  height: 24px;\n  font-size: 12px;\n  color: var(--normal-bg);\n  background: var(--normal-text);\n  margin-left: var(--toast-button-margin-start);\n  margin-right: var(--toast-button-margin-end);\n  border: none;\n  cursor: pointer;\n  outline: none;\n  display: flex;\n  align-items: center;\n  flex-shrink: 0;\n  transition: opacity 400ms, box-shadow 200ms;\n}\n:where([data-sonner-toast]) :where([data-button]):focus-visible {\n  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4);\n}\n:where([data-sonner-toast]) :where([data-button]):first-of-type {\n  margin-left: var(--toast-button-margin-start);\n  margin-right: var(--toast-button-margin-end);\n}\n:where([data-sonner-toast]) :where([data-cancel]) {\n  color: var(--normal-text);\n  background: rgba(0, 0, 0, 0.08);\n}\n:where([data-sonner-toast][data-theme=dark]) :where([data-cancel]) {\n  background: rgba(255, 255, 255, 0.3);\n}\n:where([data-sonner-toast]) :where([data-close-button]) {\n  position: absolute;\n  left: var(--toast-close-button-start);\n  right: var(--toast-close-button-end);\n  top: 0;\n  height: 20px;\n  width: 20px;\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  padding: 0;\n  background: var(--gray1);\n  color: var(--gray12);\n  border: 1px solid var(--gray4);\n  transform: var(--toast-close-button-transform);\n  border-radius: 50%;\n  cursor: pointer;\n  z-index: 1;\n  transition:\n    opacity 100ms,\n    background 200ms,\n    border-color 200ms;\n}\n:where([data-sonner-toast]) :where([data-close-button]):focus-visible {\n  box-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 2px rgba(0, 0, 0, 0.2);\n}\n:where([data-sonner-toast]) :where([data-disabled=true]) {\n  cursor: not-allowed;\n}\n:where([data-sonner-toast]):hover :where([data-close-button]):hover {\n  background: var(--gray2);\n  border-color: var(--gray5);\n}\n:where([data-sonner-toast][data-swiping=true])::before {\n  content: "";\n  position: absolute;\n  left: 0;\n  right: 0;\n  height: 100%;\n  z-index: -1;\n}\n:where([data-sonner-toast][data-y-position=top][data-swiping=true])::before {\n  bottom: 50%;\n  transform: scaleY(3) translateY(50%);\n}\n:where([data-sonner-toast][data-y-position=bottom][data-swiping=true])::before {\n  top: 50%;\n  transform: scaleY(3) translateY(-50%);\n}\n:where([data-sonner-toast][data-swiping=false][data-removed=true])::before {\n  content: "";\n  position: absolute;\n  inset: 0;\n  transform: scaleY(2);\n}\n:where([data-sonner-toast])::after {\n  content: "";\n  position: absolute;\n  left: 0;\n  height: calc(var(--gap) + 1px);\n  bottom: 100%;\n  width: 100%;\n}\n:where([data-sonner-toast][data-mounted=true]) {\n  --y: translateY(0);\n  opacity: 1;\n}\n:where([data-sonner-toast][data-expanded=false][data-front=false]) {\n  --scale: var(--toasts-before) * 0.05 + 1;\n  --y: translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));\n  height: var(--front-toast-height);\n}\n:where([data-sonner-toast]) > * {\n  transition: opacity 400ms;\n}\n:where([data-sonner-toast][data-expanded=false][data-front=false][data-styled=true]) > * {\n  opacity: 0;\n}\n:where([data-sonner-toast][data-visible=false]) {\n  opacity: 0;\n  pointer-events: none;\n}\n:where([data-sonner-toast][data-mounted=true][data-expanded=true]) {\n  --y: translateY(calc(var(--lift) * var(--offset)));\n  height: var(--initial-height);\n}\n:where([data-sonner-toast][data-removed=true][data-front=true][data-swipe-out=false]) {\n  --y: translateY(calc(var(--lift) * -100%));\n  opacity: 0;\n}\n:where([data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=true]) {\n  --y: translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));\n  opacity: 0;\n}\n:where([data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=false]) {\n  --y: translateY(40%);\n  opacity: 0;\n  transition: transform 500ms, opacity 200ms;\n}\n:where([data-sonner-toast][data-removed=true][data-front=false])::before {\n  height: calc(var(--initial-height) + 20%);\n}\n[data-sonner-toast][data-swiping=true] {\n  transform: var(--y) translateY(var(--swipe-amount, 0px));\n  transition: none;\n}\n[data-sonner-toast][data-swipe-out=true][data-y-position=bottom],\n[data-sonner-toast][data-swipe-out=true][data-y-position=top] {\n  animation: swipe-out 200ms ease-out forwards;\n}\n@keyframes swipe-out {\n  from {\n    transform: translateY(calc(var(--lift) * var(--offset) + var(--swipe-amount)));\n    opacity: 1;\n  }\n  to {\n    transform: translateY(calc(var(--lift) * var(--offset) + var(--swipe-amount) + var(--lift) * -100%));\n    opacity: 0;\n  }\n}\n@media (max-width: 600px) {\n  [data-sonner-toaster] {\n    position: fixed;\n    --mobile-offset: 16px;\n    right: var(--mobile-offset);\n    left: var(--mobile-offset);\n    width: 100%;\n  }\n  [data-sonner-toaster] [data-sonner-toast] {\n    left: 0;\n    right: 0;\n    width: calc(100% - var(--mobile-offset) * 2);\n  }\n  [data-sonner-toaster][data-x-position=left] {\n    left: var(--mobile-offset);\n  }\n  [data-sonner-toaster][data-y-position=bottom] {\n    bottom: 20px;\n  }\n  [data-sonner-toaster][data-y-position=top] {\n    top: 20px;\n  }\n  [data-sonner-toaster][data-x-position=center] {\n    left: var(--mobile-offset);\n    right: var(--mobile-offset);\n    transform: none;\n  }\n}\n[data-sonner-toaster][data-theme=light] {\n  --normal-bg: #fff;\n  --normal-border: var(--gray4);\n  --normal-text: var(--gray12);\n  --success-bg: hsl(143, 85%, 96%);\n  --success-border: hsl(145, 92%, 91%);\n  --success-text: hsl(140, 100%, 27%);\n  --info-bg: hsl(208, 100%, 97%);\n  --info-border: hsl(221, 91%, 91%);\n  --info-text: hsl(210, 92%, 45%);\n  --warning-bg: hsl(49, 100%, 97%);\n  --warning-border: hsl(49, 91%, 91%);\n  --warning-text: hsl(31, 92%, 45%);\n  --error-bg: hsl(359, 100%, 97%);\n  --error-border: hsl(359, 100%, 94%);\n  --error-text: hsl(360, 100%, 45%);\n}\n[data-sonner-toaster][data-theme=light] [data-sonner-toast][data-invert=true] {\n  --normal-bg: #000;\n  --normal-border: hsl(0, 0%, 20%);\n  --normal-text: var(--gray1);\n}\n[data-sonner-toaster][data-theme=dark] [data-sonner-toast][data-invert=true] {\n  --normal-bg: #fff;\n  --normal-border: var(--gray3);\n  --normal-text: var(--gray12);\n}\n[data-sonner-toaster][data-theme=dark] {\n  --normal-bg: #000;\n  --normal-border: hsl(0, 0%, 20%);\n  --normal-text: var(--gray1);\n  --success-bg: hsl(150, 100%, 6%);\n  --success-border: hsl(147, 100%, 12%);\n  --success-text: hsl(150, 86%, 65%);\n  --info-bg: hsl(215, 100%, 6%);\n  --info-border: hsl(223, 100%, 12%);\n  --info-text: hsl(216, 87%, 65%);\n  --warning-bg: hsl(64, 100%, 6%);\n  --warning-border: hsl(60, 100%, 12%);\n  --warning-text: hsl(46, 87%, 65%);\n  --error-bg: hsl(358, 76%, 10%);\n  --error-border: hsl(357, 89%, 16%);\n  --error-text: hsl(358, 100%, 81%);\n}\n[data-rich-colors=true] [data-sonner-toast][data-type=success] {\n  background: var(--success-bg);\n  border-color: var(--success-border);\n  color: var(--success-text);\n}\n[data-rich-colors=true] [data-sonner-toast][data-type=success] [data-close-button] {\n  background: var(--success-bg);\n  border-color: var(--success-border);\n  color: var(--success-text);\n}\n[data-rich-colors=true] [data-sonner-toast][data-type=info] {\n  background: var(--info-bg);\n  border-color: var(--info-border);\n  color: var(--info-text);\n}\n[data-rich-colors=true] [data-sonner-toast][data-type=info] [data-close-button] {\n  background: var(--info-bg);\n  border-color: var(--info-border);\n  color: var(--info-text);\n}\n[data-rich-colors=true] [data-sonner-toast][data-type=warning] {\n  background: var(--warning-bg);\n  border-color: var(--warning-border);\n  color: var(--warning-text);\n}\n[data-rich-colors=true] [data-sonner-toast][data-type=warning] [data-close-button] {\n  background: var(--warning-bg);\n  border-color: var(--warning-border);\n  color: var(--warning-text);\n}\n[data-rich-colors=true] [data-sonner-toast][data-type=error] {\n  background: var(--error-bg);\n  border-color: var(--error-border);\n  color: var(--error-text);\n}\n[data-rich-colors=true] [data-sonner-toast][data-type=error] [data-close-button] {\n  background: var(--error-bg);\n  border-color: var(--error-border);\n  color: var(--error-text);\n}\n.sonner-loading-wrapper {\n  --size: 16px;\n  height: var(--size);\n  width: var(--size);\n  position: absolute;\n  inset: 0;\n  z-index: 10;\n}\n.sonner-loading-wrapper[data-visible=false] {\n  transform-origin: center;\n  animation: sonner-fade-out 0.2s ease forwards;\n}\n.sonner-spinner {\n  position: relative;\n  top: 50%;\n  left: 50%;\n  height: var(--size);\n  width: var(--size);\n}\n.sonner-loading-bar {\n  animation: sonner-spin 1.2s linear infinite;\n  background: var(--gray11);\n  border-radius: 6px;\n  height: 8%;\n  left: -10%;\n  position: absolute;\n  top: -3.9%;\n  width: 24%;\n}\n.sonner-loading-bar:nth-child(1) {\n  animation-delay: -1.2s;\n  transform: rotate(0.0001deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(2) {\n  animation-delay: -1.1s;\n  transform: rotate(30deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(3) {\n  animation-delay: -1s;\n  transform: rotate(60deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(4) {\n  animation-delay: -0.9s;\n  transform: rotate(90deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(5) {\n  animation-delay: -0.8s;\n  transform: rotate(120deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(6) {\n  animation-delay: -0.7s;\n  transform: rotate(150deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(7) {\n  animation-delay: -0.6s;\n  transform: rotate(180deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(8) {\n  animation-delay: -0.5s;\n  transform: rotate(210deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(9) {\n  animation-delay: -0.4s;\n  transform: rotate(240deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(10) {\n  animation-delay: -0.3s;\n  transform: rotate(270deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(11) {\n  animation-delay: -0.2s;\n  transform: rotate(300deg) translate(146%);\n}\n.sonner-loading-bar:nth-child(12) {\n  animation-delay: -0.1s;\n  transform: rotate(330deg) translate(146%);\n}\n@keyframes sonner-fade-in {\n  0% {\n    opacity: 0;\n    transform: scale(0.8);\n  }\n  100% {\n    opacity: 1;\n    transform: scale(1);\n  }\n}\n@keyframes sonner-fade-out {\n  0% {\n    opacity: 1;\n    transform: scale(1);\n  }\n  100% {\n    opacity: 0;\n    transform: scale(0.8);\n  }\n}\n@keyframes sonner-spin {\n  0% {\n    opacity: 1;\n  }\n  100% {\n    opacity: 0.15;\n  }\n}\n@media (prefers-reduced-motion) {\n  [data-sonner-toast],\n  [data-sonner-toast] > *,\n  .sonner-loading-bar {\n    transition: none !important;\n    animation: none !important;\n  }\n}\n.sonner-loader {\n  position: absolute;\n  top: 50%;\n  left: 50%;\n  transform: translate(-50%, -50%);\n  transform-origin: center;\n  transition: opacity 200ms, transform 200ms;\n}\n.sonner-loader[data-visible=false] {\n  opacity: 0;\n  transform: scale(0.8) translate(-50%, -50%);\n}\n');
var bars = Array(12).fill(0);
function Loader(props) {
  return (() => {
    var _el$ = getNextElement(_tmpl$), _el$2 = _el$.firstChild;
    insert(_el$2, createComponent(For, {
      each: bars,
      children: () => getNextElement(_tmpl$2)
    }));
    createRenderEffect(() => setAttribute(_el$, "data-visible", props.visible));
    return _el$;
  })();
}
function SuccessIcon() {
  return getNextElement(_tmpl$3);
}
function WarningIcon() {
  return getNextElement(_tmpl$4);
}
function InfoIcon() {
  return getNextElement(_tmpl$5);
}
function ErrorIcon() {
  return getNextElement(_tmpl$6);
}
function getAsset(type) {
  switch (type) {
    case "success":
      return SuccessIcon;
    case "info":
      return InfoIcon;
    case "warning":
      return WarningIcon;
    case "error":
      return ErrorIcon;
    default:
      return null;
  }
}
var toastsCounter = 0;
var Observer = class {
  subscribers;
  toasts;
  constructor() {
    this.subscribers = [];
    this.toasts = [];
  }
  // We use arrow functions to maintain the correct `this` reference
  subscribe = (subscriber) => {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      this.subscribers.splice(index, 1);
    };
  };
  publish = (data) => {
    this.subscribers.forEach((subscriber) => subscriber(data));
  };
  addToast = (data) => {
    this.publish(data);
    this.toasts = [...this.toasts, data];
  };
  create = (data) => {
    const {
      message,
      ...rest
    } = data;
    const id = typeof data?.id === "number" || data.id && data.id?.length > 0 ? data.id : toastsCounter++;
    const alreadyExists = this.toasts.find((toast2) => {
      return toast2.id === id;
    });
    if (alreadyExists) {
      this.toasts = this.toasts.map((toast2) => {
        if (toast2.id === id) {
          this.publish({
            ...toast2,
            ...data,
            id,
            title: message
          });
          return {
            ...toast2,
            ...data,
            id,
            title: message
          };
        }
        return toast2;
      });
    } else {
      this.addToast({
        title: message,
        ...rest,
        id
      });
    }
    return id;
  };
  dismiss = (id) => {
    if (!id) {
      this.toasts.forEach((toast2) => {
        this.subscribers.forEach((subscriber) => subscriber({
          id: toast2.id,
          dismiss: true
        }));
      });
    }
    this.subscribers.forEach((subscriber) => subscriber({
      id,
      dismiss: true
    }));
    return id;
  };
  message = (message, data) => {
    return this.create({
      ...data,
      message
    });
  };
  error = (message, data) => {
    return this.create({
      ...data,
      message,
      type: "error"
    });
  };
  success = (message, data) => {
    return this.create({
      ...data,
      type: "success",
      message
    });
  };
  info = (message, data) => {
    return this.create({
      ...data,
      type: "info",
      message
    });
  };
  warning = (message, data) => {
    return this.create({
      ...data,
      type: "warning",
      message
    });
  };
  promise = (promise, data) => {
    if (!data) {
      return;
    }
    let id;
    if (data.loading !== void 0) {
      id = this.create({
        ...data,
        promise,
        type: "loading",
        message: data.loading
      });
    }
    const p = promise instanceof Promise ? promise : promise();
    let shouldDismiss = id !== void 0;
    p.then((response) => {
      if (response && typeof response.ok === "boolean" && !response.ok) {
        shouldDismiss = false;
        const message = typeof data.error === "function" ? data.error(`HTTP error! status: ${response.status}`) : data.error;
        this.create({
          id,
          type: "error",
          message
        });
      } else if (data.success !== void 0) {
        shouldDismiss = false;
        const message = typeof data.success === "function" ? data.success(response) : data.success;
        this.create({
          id,
          type: "success",
          message
        });
      }
    }).catch((error) => {
      if (data.error !== void 0) {
        shouldDismiss = false;
        const message = typeof data.error === "function" ? data.error(error) : data.error;
        this.create({
          id,
          type: "error",
          message
        });
      }
    }).finally(() => {
      if (shouldDismiss) {
        this.dismiss(id);
        id = void 0;
      }
      data.finally?.();
    });
    return id;
  };
  loading = (message, data) => {
    return this.create({
      ...data,
      type: "loading",
      message
    });
  };
  // We can't provide the toast we just created as a prop as we didn't create it yet, so we can create a default toast object, I just don't know how to use function in argument when calling()?
  custom = (jsx, data) => {
    const id = data?.id || toastsCounter++;
    this.publish({
      jsx: jsx(id),
      id,
      ...data
    });
    return id;
  };
};
var ToastState = new Observer();
function toastFunction(message, data) {
  const id = data?.id || toastsCounter++;
  ToastState.addToast({
    title: message,
    ...data,
    id
  });
  return id;
}
var basicToast = toastFunction;
var toast = Object.assign(basicToast, {
  success: ToastState.success,
  info: ToastState.info,
  warning: ToastState.warning,
  error: ToastState.error,
  custom: ToastState.custom,
  message: ToastState.message,
  promise: ToastState.promise,
  dismiss: ToastState.dismiss,
  loading: ToastState.loading
});
function useIsDocumentHidden() {
  const [isDocumentHidden, setIsDocumentHidden] = createSignal(false);
  onMount(() => {
    const callback = () => {
      setIsDocumentHidden(document.hidden);
    };
    document.addEventListener("visibilitychange", callback);
    onCleanup(() => {
      window.removeEventListener("visibilitychange", callback);
    });
  });
  return isDocumentHidden;
}
var VISIBLE_TOASTS_AMOUNT = 3;
var VIEWPORT_OFFSET = "32px";
var TOAST_LIFETIME = 4e3;
var TOAST_WIDTH = 356;
var GAP = 14;
var SWIPE_TRESHOLD = 20;
var TIME_BEFORE_UNMOUNT = 200;
function _cn(...classes) {
  return classes.filter(Boolean).join(" ");
}
var Toast = (props) => {
  const [mounted, setMounted] = createSignal(false);
  const [removed, setRemoved] = createSignal(false);
  const [swiping, setSwiping] = createSignal(false);
  const [swipeOut, setSwipeOut] = createSignal(false);
  const [offsetBeforeRemove, setOffsetBeforeRemove] = createSignal(0);
  const [initialHeight, setInitialHeight] = createSignal(0);
  let toastRef;
  const isFront = () => props.index === 0;
  const isVisible = () => props.index + 1 <= props.visibleToasts;
  const toastType = () => props.toast.type;
  const toastClassname = () => props.toast.class || "";
  const toastDescriptionClassname = () => props.toast.descriptionClass || "";
  const propsWithDefaults = mergeProps({
    gap: GAP
  }, props);
  const heightIndex = () => props.heights.findIndex((height) => height.toastId === props.toast.id) || 0;
  const duration = () => props.toast.duration || props.duration || TOAST_LIFETIME;
  let closeTimerStartTimeRef = 0;
  let lastCloseTimerStartTimeRef = 0;
  const [pointerStartRef, setPointerStartRef] = createSignal(null);
  const coords = () => props.position.split("-");
  const toastsHeightBefore = () => {
    return props.heights.reduce((prev, curr, reducerIndex) => {
      if (reducerIndex >= heightIndex()) return prev;
      return prev + curr.height;
    }, 0);
  };
  const isDocumentHidden = useIsDocumentHidden();
  const invert = () => props.toast.invert || props.invert;
  const disabled = () => toastType() === "loading";
  const offset = () => heightIndex() * propsWithDefaults.gap + toastsHeightBefore();
  function getLoadingIcon() {
    if (props.icons?.loading) {
      return (() => {
        var _el$8 = getNextElement(_tmpl$7);
        insert(_el$8, () => props.icons.loading);
        createRenderEffect(() => setAttribute(_el$8, "data-visible", toastType() === "loading"));
        return _el$8;
      })();
    }
    return createComponent(Loader, {
      get visible() {
        return toastType() === "loading";
      }
    });
  }
  onMount(() => {
    setMounted(true);
  });
  onMount(() => {
    const toastNode = toastRef;
    const originalHeight = toastNode.style.height;
    toastNode.style.height = "auto";
    const newHeight = toastNode.getBoundingClientRect().height;
    toastNode.style.height = originalHeight;
    setInitialHeight(newHeight);
    createEffect(() => {
      props.setHeights((heights) => {
        const alreadyExists = heights.find((height) => height.toastId === props.toast.id);
        if (!alreadyExists) return [{
          toastId: props.toast.id,
          height: newHeight,
          position: props.toast.position
        }, ...heights];
        else return heights.map((height) => height.toastId === props.toast.id ? {
          ...height,
          height: newHeight
        } : height);
      });
    });
  });
  const deleteToast = () => {
    setRemoved(true);
    setOffsetBeforeRemove(offset());
    props.setHeights((h) => h.filter((height) => height.toastId !== props.toast.id));
    setTimeout(() => {
      props.removeToast(props.toast);
    }, TIME_BEFORE_UNMOUNT);
  };
  let remainingTime = duration();
  createEffect(on(() => [props.expanded, props.interacting, props.toast, duration(), props.toast.promise, toastType(), props.pauseWhenPageIsHidden, isDocumentHidden()], ([expanded, interacting, toast2, duration2, promise, toastType2, pauseWhenPageIsHidden, isDocumentHidden2]) => {
    if (promise && toastType2 === "loading" || duration2 === Number.POSITIVE_INFINITY) return;
    let timeoutId;
    const pauseTimer = () => {
      if (lastCloseTimerStartTimeRef < closeTimerStartTimeRef) {
        const elapsedTime = (/* @__PURE__ */ new Date()).getTime() - closeTimerStartTimeRef;
        remainingTime = remainingTime - elapsedTime;
      }
      lastCloseTimerStartTimeRef = (/* @__PURE__ */ new Date()).getTime();
    };
    const startTimer = () => {
      closeTimerStartTimeRef = (/* @__PURE__ */ new Date()).getTime();
      timeoutId = setTimeout(() => {
        toast2.onAutoClose?.(toast2);
        deleteToast();
      }, remainingTime);
    };
    if (expanded || interacting || pauseWhenPageIsHidden && isDocumentHidden2) pauseTimer();
    else startTimer();
    onCleanup(() => {
      clearTimeout(timeoutId);
    });
  }));
  createEffect(on(() => props.toast.id, (toastId) => {
    const toastNode = toastRef;
    if (toastNode) {
      const height = toastNode.getBoundingClientRect().height;
      setInitialHeight(height);
      props.setHeights((h) => [{
        toastId,
        height,
        position: props.toast.position
      }, ...h]);
      onCleanup(() => {
        props.setHeights((h) => h.filter((height2) => height2.toastId !== toastId));
      });
    }
  }));
  createEffect(on(() => props.toast.delete, (d) => {
    if (d) deleteToast();
  }));
  return (() => {
    var _el$9 = getNextElement(_tmpl$9), _el$1 = _el$9.firstChild, [_el$10, _co$] = getNextMarker(_el$1.nextSibling), _el$11 = _el$10.nextSibling, [_el$12, _co$2] = getNextMarker(_el$11.nextSibling);
    _el$9.$$pointermove = (event) => {
      if (!pointerStartRef()) return;
      const yPosition = event.clientY - pointerStartRef().y;
      const xPosition = event.clientX - pointerStartRef().x;
      const clamp = coords()[0] === "top" ? Math.min : Math.max;
      const clampedY = clamp(0, yPosition);
      const swipeStartThreshold = event.pointerType === "touch" ? 10 : 2;
      const isAllowedToSwipe = Math.abs(clampedY) > swipeStartThreshold;
      if (isAllowedToSwipe) {
        toastRef?.style.setProperty("--swipe-amount", `${yPosition}px`);
      } else if (Math.abs(xPosition) > swipeStartThreshold) {
        setPointerStartRef(null);
      }
    };
    _el$9.$$pointerup = () => {
      if (swipeOut()) return;
      setPointerStartRef(null);
      const swipeAmount = Number(toastRef?.style.getPropertyValue("--swipe-amount").replace("px", "") || 0);
      if (Math.abs(swipeAmount) >= SWIPE_TRESHOLD) {
        setOffsetBeforeRemove(offset());
        props.toast.onDismiss?.(props.toast);
        deleteToast();
        setSwipeOut(true);
        return;
      }
      toastRef?.style.setProperty("--swipe-amount", "0px");
      setSwiping(false);
    };
    _el$9.$$pointerdown = (event) => {
      if (disabled()) return;
      setOffsetBeforeRemove(offset());
      event.target.setPointerCapture(event.pointerId);
      if (event.target.tagName === "BUTTON") return;
      setSwiping(true);
      setPointerStartRef({
        x: event.clientX,
        y: event.clientY
      });
    };
    var _ref$ = toastRef;
    typeof _ref$ === "function" ? use(_ref$, _el$9) : toastRef = _el$9;
    insert(_el$9, createComponent(Show, {
      get when() {
        return memo(() => !!props.closeButton)() && !props.toast.jsx;
      },
      get children() {
        var _el$0 = getNextElement(_tmpl$8);
        addEventListener(_el$0, "click", disabled() ? void 0 : () => {
          deleteToast();
          props.toast.onDismiss?.(props.toast);
        }, true);
        createRenderEffect((_p$) => {
          var _v$ = disabled(), _v$2 = _cn(props.classes?.closeButton, props.toast?.classes?.closeButton);
          _v$ !== _p$.e && setAttribute(_el$0, "data-disabled", _p$.e = _v$);
          _v$2 !== _p$.t && className(_el$0, _p$.t = _v$2);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        runHydrationEvents();
        return _el$0;
      }
    }), _el$10, _co$);
    insert(_el$9, createComponent(Show, {
      get when() {
        return props.toast.jsx || props.toast.title instanceof Element;
      },
      get fallback() {
        return [createComponent(Show, {
          get when() {
            return toastType() || props.toast.icon || props.toast.promise;
          },
          get children() {
            var _el$13 = getNextElement(_tmpl$0), _el$14 = _el$13.firstChild, [_el$15, _co$3] = getNextMarker(_el$14.nextSibling), _el$16 = _el$15.nextSibling, [_el$17, _co$4] = getNextMarker(_el$16.nextSibling);
            insert(_el$13, (() => {
              var _c$ = memo(() => !!(props.toast.promise || props.toast.type === "loading" && !props.toast.icon));
              return () => _c$() ? props.toast.icon || getLoadingIcon() : null;
            })(), _el$15, _co$3);
            insert(_el$13, (() => {
              var _c$2 = memo(() => props.toast.type !== "loading");
              return () => _c$2() ? props.toast.icon || props.icons?.[toastType()] || getAsset(toastType())() : null;
            })(), _el$17, _co$4);
            return _el$13;
          }
        }), (() => {
          var _el$18 = getNextElement(_tmpl$10), _el$19 = _el$18.firstChild, _el$21 = _el$19.nextSibling, [_el$22, _co$5] = getNextMarker(_el$21.nextSibling);
          insert(_el$19, () => props.toast.title);
          insert(_el$18, createComponent(Show, {
            get when() {
              return props.toast.description;
            },
            get children() {
              var _el$20 = getNextElement(_tmpl$1);
              insert(_el$20, () => props.toast.description);
              createRenderEffect(() => className(_el$20, _cn(props.descriptionClass, toastDescriptionClassname(), props.classes?.description, props.toast?.classes?.description)));
              return _el$20;
            }
          }), _el$22, _co$5);
          createRenderEffect(() => className(_el$19, _cn(props.classes?.title, props.toast?.classes?.title)));
          return _el$18;
        })(), createComponent(Show, {
          get when() {
            return props.toast.cancel;
          },
          get children() {
            var _el$23 = getNextElement(_tmpl$11);
            _el$23.$$click = () => {
              deleteToast();
              if (props.toast.cancel?.onClick) props.toast.cancel.onClick();
            };
            insert(_el$23, () => props.toast.cancel.label);
            createRenderEffect((_p$) => {
              var _v$18 = props.toast.cancelButtonStyle || props.cancelButtonStyle, _v$19 = _cn(props.classes?.cancelButton, props.toast?.classes?.cancelButton);
              _p$.e = style(_el$23, _v$18, _p$.e);
              _v$19 !== _p$.t && className(_el$23, _p$.t = _v$19);
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            runHydrationEvents();
            return _el$23;
          }
        }), createComponent(Show, {
          get when() {
            return props.toast.action;
          },
          get children() {
            var _el$24 = getNextElement(_tmpl$12);
            _el$24.$$click = (event) => {
              props.toast.action?.onClick(event);
              if (event.defaultPrevented) return;
              deleteToast();
            };
            insert(_el$24, () => props.toast.action.label);
            createRenderEffect((_p$) => {
              var _v$20 = props.toast.actionButtonStyle || props.actionButtonStyle, _v$21 = _cn(props.classes?.actionButton, props.toast?.classes?.actionButton);
              _p$.e = style(_el$24, _v$20, _p$.e);
              _v$21 !== _p$.t && className(_el$24, _p$.t = _v$21);
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            runHydrationEvents();
            return _el$24;
          }
        })];
      },
      get children() {
        return props.toast.jsx || props.toast.title;
      }
    }), _el$12, _co$2);
    createRenderEffect((_p$) => {
      var _v$3 = props.toast.important ? "assertive" : "polite", _v$4 = _cn(props.class, toastClassname(), props.classes?.toast, props.toast?.classes?.toast, props.classes?.default, props.classes?.[toastType()], props.toast?.classes?.[toastType()]), _v$5 = !(props.toast.jsx || props.toast.unstyled || props.unstyled), _v$6 = mounted(), _v$7 = Boolean(props.toast.promise), _v$8 = removed(), _v$9 = isVisible(), _v$0 = coords()[0], _v$1 = coords()[1], _v$10 = props.index, _v$11 = isFront(), _v$12 = swiping(), _v$13 = toastType(), _v$14 = invert(), _v$15 = swipeOut(), _v$16 = Boolean(props.expanded || props.expandByDefault && mounted()), _v$17 = {
        "--index": props.index,
        "--toasts-before": props.index,
        "--z-index": props.toasts.length - props.index,
        "--offset": `${removed() ? offsetBeforeRemove() : offset()}px`,
        "--initial-height": props.expandByDefault ? "auto" : `${initialHeight()}px`,
        ...props.style,
        ...props.toast.style
      };
      _v$3 !== _p$.e && setAttribute(_el$9, "aria-live", _p$.e = _v$3);
      _v$4 !== _p$.t && className(_el$9, _p$.t = _v$4);
      _v$5 !== _p$.a && setAttribute(_el$9, "data-styled", _p$.a = _v$5);
      _v$6 !== _p$.o && setAttribute(_el$9, "data-mounted", _p$.o = _v$6);
      _v$7 !== _p$.i && setAttribute(_el$9, "data-promise", _p$.i = _v$7);
      _v$8 !== _p$.n && setAttribute(_el$9, "data-removed", _p$.n = _v$8);
      _v$9 !== _p$.s && setAttribute(_el$9, "data-visible", _p$.s = _v$9);
      _v$0 !== _p$.h && setAttribute(_el$9, "data-y-position", _p$.h = _v$0);
      _v$1 !== _p$.r && setAttribute(_el$9, "data-x-position", _p$.r = _v$1);
      _v$10 !== _p$.d && setAttribute(_el$9, "data-index", _p$.d = _v$10);
      _v$11 !== _p$.l && setAttribute(_el$9, "data-front", _p$.l = _v$11);
      _v$12 !== _p$.u && setAttribute(_el$9, "data-swiping", _p$.u = _v$12);
      _v$13 !== _p$.c && setAttribute(_el$9, "data-type", _p$.c = _v$13);
      _v$14 !== _p$.w && setAttribute(_el$9, "data-invert", _p$.w = _v$14);
      _v$15 !== _p$.m && setAttribute(_el$9, "data-swipe-out", _p$.m = _v$15);
      _v$16 !== _p$.f && setAttribute(_el$9, "data-expanded", _p$.f = _v$16);
      _p$.y = style(_el$9, _v$17, _p$.y);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0,
      s: void 0,
      h: void 0,
      r: void 0,
      d: void 0,
      l: void 0,
      u: void 0,
      c: void 0,
      w: void 0,
      m: void 0,
      f: void 0,
      y: void 0
    });
    runHydrationEvents();
    return _el$9;
  })();
};
function getDocumentDirection() {
  if (typeof window === "undefined") return "ltr";
  if (typeof document === "undefined") return "ltr";
  const dirAttribute = document.documentElement.getAttribute("dir");
  if (dirAttribute === "auto" || !dirAttribute) return window.getComputedStyle(document.documentElement).direction;
  return dirAttribute;
}
var Toaster = (props) => {
  const propsWithDefaults = mergeProps({
    position: "bottom-right",
    hotkey: ["altKey", "KeyT"],
    theme: "light",
    visibleToasts: VISIBLE_TOASTS_AMOUNT,
    dir: getDocumentDirection()
  }, props);
  const [toastsStore, setToastsStore] = createStore({
    toasts: []
  });
  const possiblePositions = () => {
    return Array.from(new Set([propsWithDefaults.position].concat(toastsStore.toasts.filter((toast2) => toast2.position).map((toast2) => toast2.position))));
  };
  const [heights, setHeights] = createSignal([]);
  const [expanded, setExpanded] = createSignal(false);
  const [interacting, setInteracting] = createSignal(false);
  let listRef;
  const hotkeyLabel = () => propsWithDefaults.hotkey.join("+").replace(/Key/g, "").replace(/Digit/g, "");
  const [lastFocusedElementRef, setLastFocusedElementRef] = createSignal(null);
  const [isFocusedWithinRef, setIsFocusedWithinRef] = createSignal(false);
  const [actualTheme, setActualTheme] = createSignal(propsWithDefaults.theme !== "system" ? propsWithDefaults.theme : typeof window !== "undefined" ? window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" : "light");
  const removeToast = (toast2) => setToastsStore("toasts", (toasts) => toasts.filter(({
    id
  }) => id !== toast2.id));
  onMount(() => {
    const unsub = ToastState.subscribe((toast2) => {
      if (toast2.dismiss) {
        setToastsStore("toasts", produce((_toasts) => {
          _toasts.forEach((t) => {
            if (t.id === toast2.id) t.delete = true;
          });
        }));
        return;
      }
      const changedIndex = toastsStore.toasts.findIndex((t) => t.id === toast2.id);
      if (changedIndex !== -1) {
        setToastsStore("toasts", [changedIndex], reconcile(toast2));
        return;
      }
      setToastsStore("toasts", produce((_toasts) => {
        _toasts.unshift(toast2);
      }));
    });
    onCleanup(() => {
      unsub();
    });
  });
  createEffect(on(() => propsWithDefaults.theme, (theme) => {
    if (theme !== "system") {
      setActualTheme(theme);
      return;
    }
    if (typeof window === "undefined") return;
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ({
      matches
    }) => {
      if (matches) setActualTheme("dark");
      else setActualTheme("light");
    });
  }));
  createEffect(() => {
    if (toastsStore.toasts.length <= 1) setExpanded(false);
  });
  onMount(() => {
    const handleKeyDown = (event) => {
      const isHotkeyPressed = propsWithDefaults.hotkey.every((key) => event[key] || event.code === key);
      if (isHotkeyPressed) {
        setExpanded(true);
        listRef?.focus();
      }
      if (event.code === "Escape" && (document.activeElement === listRef || listRef?.contains(document.activeElement))) setExpanded(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
    });
  });
  createEffect(on(() => listRef, (ref) => {
    if (ref) {
      onCleanup(() => {
        if (lastFocusedElementRef()) {
          lastFocusedElementRef()?.focus({
            preventScroll: true
          });
          setLastFocusedElementRef(null);
          setIsFocusedWithinRef(false);
        }
      });
    }
  }));
  return createComponent(Show, {
    get when() {
      return toastsStore.toasts.length > 0;
    },
    get children() {
      var _el$25 = getNextElement(_tmpl$13);
      insert(_el$25, createComponent(For, {
        get each() {
          return possiblePositions();
        },
        children: (position, index) => {
          const [y, x] = position.split("-");
          return (() => {
            var _el$26 = getNextElement(_tmpl$14);
            _el$26.$$pointerup = () => setInteracting(false);
            _el$26.$$pointerdown = () => {
              setInteracting(true);
            };
            _el$26.addEventListener("mouseleave", () => {
              if (!interacting()) setExpanded(false);
            });
            _el$26.$$mousemove = () => setExpanded(true);
            _el$26.addEventListener("mouseenter", () => setExpanded(true));
            _el$26.addEventListener("focus", (event) => {
              if (!isFocusedWithinRef()) {
                setIsFocusedWithinRef(true);
                setLastFocusedElementRef(event.relatedTarget);
              }
            });
            _el$26.addEventListener("blur", (event) => {
              if (isFocusedWithinRef() && !event.currentTarget.contains(event.relatedTarget)) {
                setIsFocusedWithinRef(false);
                if (lastFocusedElementRef()) {
                  lastFocusedElementRef()?.focus({
                    preventScroll: true
                  });
                  setLastFocusedElementRef(null);
                }
              }
            });
            var _ref$2 = listRef;
            typeof _ref$2 === "function" ? use(_ref$2, _el$26) : listRef = _el$26;
            setAttribute(_el$26, "data-y-position", y);
            setAttribute(_el$26, "data-x-position", x);
            insert(_el$26, createComponent(For, {
              get each() {
                return toastsStore.toasts.filter((toast2) => !toast2.position && index() === 0 || toast2.position === position);
              },
              children: (toast2, index2) => createComponent(Toast, {
                get index() {
                  return index2();
                },
                get icons() {
                  return propsWithDefaults.icons;
                },
                toast: toast2,
                get duration() {
                  return propsWithDefaults.toastOptions?.duration ?? props.duration;
                },
                get ["class"]() {
                  return propsWithDefaults.toastOptions?.class;
                },
                get classes() {
                  return propsWithDefaults.toastOptions?.classes;
                },
                get cancelButtonStyle() {
                  return propsWithDefaults.toastOptions?.cancelButtonStyle;
                },
                get actionButtonStyle() {
                  return propsWithDefaults.toastOptions?.actionButtonStyle;
                },
                get descriptionClass() {
                  return propsWithDefaults.toastOptions?.descriptionClass;
                },
                get invert() {
                  return Boolean(propsWithDefaults.invert);
                },
                get visibleToasts() {
                  return propsWithDefaults.visibleToasts;
                },
                get closeButton() {
                  return Boolean(propsWithDefaults.closeButton);
                },
                get interacting() {
                  return interacting();
                },
                get position() {
                  return propsWithDefaults.position;
                },
                get style() {
                  return propsWithDefaults.toastOptions?.style;
                },
                get unstyled() {
                  return propsWithDefaults.toastOptions?.unstyled;
                },
                removeToast,
                get toasts() {
                  return toastsStore.toasts;
                },
                get heights() {
                  return heights();
                },
                setHeights,
                get expandByDefault() {
                  return Boolean(propsWithDefaults.expand);
                },
                get gap() {
                  return propsWithDefaults.gap;
                },
                get expanded() {
                  return expanded();
                },
                get pauseWhenPageIsHidden() {
                  return propsWithDefaults.pauseWhenPageIsHidden;
                }
              })
            }));
            createRenderEffect((_p$) => {
              var _v$22 = propsWithDefaults.dir === "auto" ? getDocumentDirection() : propsWithDefaults.dir, _v$23 = propsWithDefaults.class, _v$24 = actualTheme(), _v$25 = propsWithDefaults.richColors, _v$26 = {
                "--front-toast-height": `${heights()[0]?.height}px`,
                "--offset": typeof propsWithDefaults.offset === "number" ? `${propsWithDefaults.offset}px` : propsWithDefaults.offset || VIEWPORT_OFFSET,
                "--width": `${TOAST_WIDTH}px`,
                "--gap": `${GAP}px`,
                ...propsWithDefaults.style
              };
              _v$22 !== _p$.e && setAttribute(_el$26, "dir", _p$.e = _v$22);
              _v$23 !== _p$.t && className(_el$26, _p$.t = _v$23);
              _v$24 !== _p$.a && setAttribute(_el$26, "data-theme", _p$.a = _v$24);
              _v$25 !== _p$.o && setAttribute(_el$26, "data-rich-colors", _p$.o = _v$25);
              _p$.i = style(_el$26, _v$26, _p$.i);
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0,
              o: void 0,
              i: void 0
            });
            runHydrationEvents();
            return _el$26;
          })();
        }
      }));
      createRenderEffect(() => setAttribute(_el$25, "aria-label", `Notifications ${hotkeyLabel()}`));
      return _el$25;
    }
  });
};
/*!
 * Original code by Emil Kowalski
 * MIT Licensed, Copyright 2023 Emil Kowalski, see https://github.com/emilkowalski/sonner/blob/main/LICENSE.md for details
 *
 * Credits:
 * https://github.com/emilkowalski/sonner/blob/main/src/index.tsx
 */
delegateEvents(["pointerdown", "pointerup", "pointermove", "click", "mousemove"]);
export {
  Toaster as T,
  toast as t
};
