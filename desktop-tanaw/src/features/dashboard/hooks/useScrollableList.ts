import { useLayoutEffect, useRef, useState } from "react";

/**
 * Tracks whether a list scrolls on its own and whether more of it sits below. A list that scrolls
 * takes keyboard focus so its rows can be reached, and fades its bottom edge while rows are hidden.
 */
export function useScrollableList<T extends HTMLElement>(dependency: unknown) {
  const ref = useRef<T>(null);
  const [state, setState] = useState({ scrollable: false, more: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const scrollable = element.scrollHeight > element.clientHeight + 1;
      const more = scrollable && element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      setState((current) => (current.scrollable === scrollable && current.more === more ? current : { scrollable, more }));
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    for (const child of Array.from(element.children)) observer?.observe(child);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [dependency]);
  return {
    ref,
    scrollable: state.scrollable,
    listProps: { tabIndex: state.scrollable ? 0 : undefined, "data-scrollable": state.scrollable, "data-more": state.more },
  };
}
