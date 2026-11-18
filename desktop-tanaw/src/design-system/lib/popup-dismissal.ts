/*
 * GENERATED FILE. Do not edit; change design-system/src/lib/popup-dismissal.ts instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: ff88fae517cec17ebfb5272367ef8febf405b4ba607176a1fe0b13f91483292f
 */
import { useEffect } from "react";

type ElementRef = { readonly current: HTMLElement | null };

const OPEN_EVENT = "tanaw:exclusive-popup-open";

/**
 * Exclusive popups: opening one closes any other, Escape closes it, and an outside click only
 * dismisses it (the click does not also press whatever was under the pointer, so a dismissing
 * click cannot submit a form). Clicking another popup trigger (data-exclusive-popup-trigger)
 * switches popups in one click.
 */
export function useExclusivePopupDismissal(open: boolean, close: (restoreFocus?: boolean) => void, trigger: ElementRef, content: ElementRef): void {
  useEffect(() => {
    if (!open) return undefined;
    const owner = trigger.current;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: owner }));
    const otherOpened = (event: Event) => {
      if ((event as CustomEvent).detail !== owner) close();
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (owner?.contains(target) || content.current?.contains(target)) return;
      close();
      if (!target.closest("[data-exclusive-popup-trigger]")) {
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
