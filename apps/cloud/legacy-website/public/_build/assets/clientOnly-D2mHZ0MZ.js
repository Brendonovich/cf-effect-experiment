import { e as createSignal, i as splitProps, k as onMount, a as createMemo, s as sharedConfig, u as untrack } from "./solid-COykZtSy.js";
function clientOnly(fn, options = {}) {
  const [comp, setComp] = createSignal();
  !options.lazy && load(fn, setComp);
  return (props) => {
    let Comp;
    let m;
    const [, rest] = splitProps(props, ["fallback"]);
    options.lazy && load(fn, setComp);
    if ((Comp = comp()) && !sharedConfig.context) return Comp(rest);
    const [mounted, setMounted] = createSignal(!sharedConfig.context);
    onMount(() => setMounted(true));
    return createMemo(() => (Comp = comp(), m = mounted(), untrack(() => Comp && m ? Comp(rest) : props.fallback)));
  };
}
function load(fn, setComp) {
  fn().then((m) => setComp(() => m.default));
}
export {
  clientOnly as c
};
