import { useLayoutEffect, useRef, type RefObject } from "react";

/** Page enter timing: long enough to read as a change of place, short enough never to wait on. */
const PAGE_ENTER_MS = 260;
const PAGE_ENTER_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Fades an element in (and lifts it a few pixels when `rise` is set) whenever `key` changes, for
 * example when the person moves to another page. The first render is left alone so a fresh load
 * shows its content at once, and reduced motion turns it off. It uses the Web Animations API, so
 * nothing re-mounts and no state is lost.
 */
export function usePageEnter<T extends HTMLElement>(ref: RefObject<T | null>, key: unknown, { rise = 4 }: { rise?: number } = {}) {
  const isFirstRender = useRef(true);
  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const element = ref.current;
    if (!element || typeof element.animate !== "function") return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const keyframes: Keyframe[] = rise
      ? [
          { opacity: 0, transform: `translateY(${rise}px)` },
          { opacity: 1, transform: "none" },
        ]
      : [{ opacity: 0 }, { opacity: 1 }];
    const animation = element.animate(keyframes, { duration: PAGE_ENTER_MS, easing: PAGE_ENTER_EASING });
    return () => animation.cancel();
  }, [key, ref, rise]);
}
