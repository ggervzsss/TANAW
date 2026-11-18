import { useEffect, useRef } from "react";

type ElementRef = { readonly current: HTMLElement | null };

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';

/**
 * Keeps keyboard focus inside a dialog while it is open, closes it on Escape, and returns focus
 * to the element that opened it.
 */
export function useDialogFocus(container: ElementRef, onEscape: () => void, enabled = true): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const node = container.current;
      if (node && !node.contains(document.activeElement)) node.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const node = container.current;
      const nodes = Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((element) => element.getClientRects().length > 0);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [container, enabled]);
}
