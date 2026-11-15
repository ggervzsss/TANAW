import { useEffect, type RefObject } from "react";

const OPEN_EVENT = "tanaw:reports-popup-open";

/** Reports popups share dismissal without allowing a dismissing click to submit a form. */
export function usePopupDismissal(open: boolean, close: (restoreFocus?: boolean) => void, trigger: RefObject<HTMLElement>, content: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const owner = trigger.current;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: owner }));
    const otherOpened = (event: Event) => {
      if ((event as CustomEvent).detail !== owner) close();
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (owner?.contains(target) || content.current?.contains(target)) return;
      close();
      // Switching popups is intentional; other outside actions only dismiss.
      if (!target.closest("[data-reports-popup-trigger]")) {
        event.preventDefault();
        event.stopPropagation();
        document.addEventListener("click", swallowClick, { capture: true, once: true });
        document.addEventListener("pointerup", () => window.setTimeout(() => document.removeEventListener("click", swallowClick, true), 0), { once: true, capture: true });
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    window.addEventListener(OPEN_EVENT, otherOpened);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener(OPEN_EVENT, otherOpened);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, close, trigger, content]);
}

function swallowClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}
