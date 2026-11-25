import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ModalPortalProps = {
  children: ReactNode;
  /** Stops the page behind from scrolling while open (dialogs). Menus and tooltips leave it off. */
  lockScroll?: boolean;
};

/** Marks a layout element that scrolls the page, such as the portal's `<main>`, so dialogs can hold it still. */
export const PAGE_SCROLLER_ATTRIBUTE = "data-page-scroller";

let openLocks = 0;
let restoreLocked: (() => void) | null = null;

/** Holds the body and every page scroller still. A scroller keeps its scrollbar gutter so nothing shifts. */
function lockPageScroll() {
  const targets = [document.body, ...document.querySelectorAll<HTMLElement>(`[${PAGE_SCROLLER_ATTRIBUTE}]`)];
  const previous = targets.map((element) => ({ element, overflow: element.style.overflow, gutter: element.style.scrollbarGutter }));
  for (const element of targets) {
    if (element !== document.body && element.scrollHeight > element.clientHeight) element.style.scrollbarGutter = "stable";
    element.style.overflow = "hidden";
  }
  return () => {
    for (const { element, overflow, gutter } of previous) {
      element.style.overflow = overflow;
      element.style.scrollbarGutter = gutter;
    }
  };
}

/**
 * Renders children into document.body so overlays escape every ancestor's overflow, stacking
 * context and transform, and position: fixed means the viewport.
 */
export function ModalPortal({ children, lockScroll = false }: ModalPortalProps) {
  const root = typeof document === "undefined" ? null : document.body;

  useEffect(() => {
    if (!root || !lockScroll) return undefined;
    // Stacked dialogs share one lock, released when the last one closes.
    if (openLocks === 0) restoreLocked = lockPageScroll();
    openLocks += 1;
    return () => {
      openLocks -= 1;
      if (openLocks === 0) {
        restoreLocked?.();
        restoreLocked = null;
      }
    };
  }, [root, lockScroll]);

  return root ? createPortal(children, root) : null;
}
