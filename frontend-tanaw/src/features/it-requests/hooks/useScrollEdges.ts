import { useLayoutEffect, type RefObject } from "react";

/**
 * For a pane that scrolls inside itself (the requests table and the open request on wide screens):
 * marks it with `data-more-above` / `data-more-below` while content hides past that edge, so its
 * stylesheet fades that edge out. The marks follow scrolling, the pane's size and its content (rows
 * arriving, a request growing), and are cleared while `enabled` is off. They are set straight on
 * the element, so scrolling never re-renders the page.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const mark = (above: boolean, below: boolean) => {
      node.toggleAttribute("data-more-above", above);
      node.toggleAttribute("data-more-below", below);
    };
    if (!enabled) {
      mark(false, false);
      return undefined;
    }
    const update = () => {
      const max = node.scrollHeight - node.clientHeight;
      mark(max > 1 && node.scrollTop > 1, max > 1 && node.scrollTop < max - 1);
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const observeAll = () => {
      if (!resize) return;
      resize.disconnect();
      resize.observe(node);
      for (const child of Array.from(node.children)) resize.observe(child);
    };
    observeAll();
    const mutations =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            observeAll();
            update();
          });
    mutations?.observe(node, { childList: true });
    return () => {
      node.removeEventListener("scroll", update);
      resize?.disconnect();
      mutations?.disconnect();
      mark(false, false);
    };
  }, [enabled, ref]);
}
