import { i as splitProps, b as createComponent, m as mergeProps } from "./solid-COykZtSy.js";
import { c as cn } from "./button-dTk4F7f6.js";
import { M as MenuTrigger, l as DropdownMenuContent$1, n as MenuPortal, S as SeparatorRoot, o as MenuItem, p as DropdownMenuRoot } from "./ZUHR2BAH-DciGzthU.js";
const DropdownMenu = (props) => {
  return createComponent(DropdownMenuRoot, mergeProps({
    gutter: 4
  }, props));
};
const DropdownMenuTrigger = MenuTrigger;
const DropdownMenuContent = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return createComponent(MenuPortal, {
    get children() {
      return createComponent(DropdownMenuContent$1, mergeProps({
        get ["class"]() {
          return cn("bg-popover text-popover-foreground animate-content-hide data-[expanded]:animate-content-show z-50 min-w-[8rem] origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-md border border-border p-1 shadow-md", props.class);
        }
      }, rest));
    }
  });
};
const DropdownMenuItem = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return createComponent(MenuItem, mergeProps({
    get ["class"]() {
      return cn("ui-highlighted:bg-accent ui-highlighted:text-accent-foreground relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors duration-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50", props.class);
    }
  }, rest));
};
const DropdownMenuSeparator = (props) => {
  const [, rest] = splitProps(props, ["class"]);
  return createComponent(SeparatorRoot, mergeProps({
    get ["class"]() {
      return cn("bg-muted -mx-1 my-1 h-px", props.class);
    }
  }, rest));
};
export {
  DropdownMenuContent as D,
  DropdownMenuItem as a,
  DropdownMenu as b,
  DropdownMenuTrigger as c,
  DropdownMenuSeparator as d
};
