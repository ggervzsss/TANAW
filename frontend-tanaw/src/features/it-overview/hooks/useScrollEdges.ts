import { useLayoutEffect, useRef, useState } from "react";

type Edges = { scrollable: boolean; atTop: boolean; atEnd: boolean };

const RESTING: Edges = { scrollable: false, atTop: true, atEnd: true };

/**
 * Tracks whether a list scrolls inside itself and which of its edges have more rows past them.
 * The list fades an edge while rows hide past it, and takes keyboard focus while it scrolls so
 * it can be scrolled from the keyboard.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState<Edges>(RESTING);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const scrollable = element.scrollHeight > element.clientHeight + 1;
      const atTop = !scrollable || element.scrollTop <= 1;
      const atEnd = !scrollable || element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
      setEdges((current) => (current.scrollable === scrollable && current.atTop === atTop && current.atEnd === atEnd ? current : { scrollable, atTop, atEnd }));
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const observeAll = () => {
      if (!resize) return;
      resize.disconnect();
      resize.observe(element);
      for (const child of Array.from(element.children)) resize.observe(child);
    };
    observeAll();
    const mutations = new MutationObserver(() => {
      observeAll();
      measure();
    });
    mutations.observe(element, { childList: true });
    return () => {
      element.removeEventListener("scroll", measure);
      resize?.disconnect();
      mutations.disconnect();
    };
  }, []);

  return {
    ref,
    scrollProps: {
      tabIndex: edges.scrollable ? 0 : undefined,
      "data-scrollable": edges.scrollable,
      "data-at-top": edges.atTop,
      "data-at-end": edges.atEnd,
    },
  };
}
