import { useEffect, useRef } from "react";

type ElementRef = { readonly current: HTMLElement | null };

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]";

/**
 * Keeps keyboard focus inside a dialog while it is open, closes it on Escape, and returns focus
 * to the element that opened it. The panel must be programmatically focusable
 * and may provide a selector for a preferred initial focus target.
 *
 * Pass `paused` while another dialog sits on top: the trap stops handling Escape and Tab but stays
 * mounted, so focus is not sent behind the dialog and the opener is still restored when it closes.
 */
export function useDialogFocus(
  container: ElementRef,
  onEscape: () => void,
  enabled = true,
  initialFocusSelector?: string,
  paused = false,
): void {
  const onEscapeRef = useRef(onEscape);
  const pausedRef = useRef(paused);
  useEffect(() => {
    onEscapeRef.current = onEscape;
    pausedRef.current = paused;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const node = container.current;
      if (!node || node.contains(document.activeElement)) return;
      const preferred = initialFocusSelector ? node.querySelector<HTMLElement>(initialFocusSelector) : null;
      (preferred ?? node).focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || pausedRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const node = container.current;
      const nodes = Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0,
      );
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const atBoundary = document.activeElement === node || document.activeElement === document.body;
      if (event.shiftKey && (document.activeElement === first || atBoundary)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || atBoundary)) {
        event.preventDefault();
        first.focus();
      }
    };
    // Portalled controls such as Select can consume Escape before it reaches the dialog.
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [container, enabled, initialFocusSelector]);
}
