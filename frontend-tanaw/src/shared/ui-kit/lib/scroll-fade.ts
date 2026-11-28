import { useLayoutEffect, type RefObject } from "react";

/**
 * For a row that scrolls sideways when it does not fit (tabs, segmented choices, the settings
 * sections on phones): marks the element with `data-fade-start` / `data-fade-end` while content is
 * hidden past that edge, so `.tanaw-scroll-x` (Controls.css) fades that edge out. It also brings
 * the chosen item (`selector`) into view whenever `key` changes, without moving the page.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, key?: unknown, selector = '[aria-selected="true"], [aria-checked="true"], [aria-current]') {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => {
      const max = node.scrollWidth - node.clientWidth;
      const start = max > 1 && node.scrollLeft > 1;
      const end = max > 1 && node.scrollLeft < max - 1;
      node.toggleAttribute("data-fade-start", start);
      node.toggleAttribute("data-fade-end", end);
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [ref]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || node.scrollWidth <= node.clientWidth) return;
    const chosen = node.querySelector<HTMLElement>(selector);
    if (!chosen) return;
    const box = node.getBoundingClientRect();
    const item = chosen.getBoundingClientRect();
    const left = item.left - box.left + node.scrollLeft;
    const right = left + item.width;
    // Leave room for a peek of the neighbour, so it is clear the row goes on.
    const pad = 64;
    if (left - pad < node.scrollLeft) node.scrollLeft = Math.max(0, left - pad);
    else if (right + pad > node.scrollLeft + node.clientWidth) node.scrollLeft = right + pad - node.clientWidth;
  }, [key, ref, selector]);
}
