import { useEffect, useRef } from "react";

export function useAuthStageGlow<TElement extends HTMLElement>() {
  const stageRef = useRef<TElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const cursor = cursorRef.current;
    if (!stage || !cursor) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(any-pointer: fine)");
    let bounds: DOMRect | null = null;
    let frame: number | null = null;
    let canFollow = false;
    let latestPosition = { x: 0, y: 0 };

    const cancelFrame = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    };

    const syncAvailability = () => {
      stage.toggleAttribute("data-auth-effects-paused", document.hidden);
      canFollow = !document.hidden && !reducedMotion.matches && finePointer.matches;
      if (!canFollow) cancelFrame();
      if (reducedMotion.matches || !finePointer.matches) cursor.style.removeProperty("transform");
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (!canFollow || event.pointerType === "touch") return;
      bounds ??= stage.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;

      latestPosition = {
        x: clamp(event.clientX - bounds.left, 0, bounds.width),
        y: clamp(event.clientY - bounds.top, 0, bounds.height),
      };
      if (frame !== null) return;

      frame = window.requestAnimationFrame(() => {
        frame = null;
        const { x, y } = latestPosition;
        // Move only this layer; inherited stage variables invalidate the form's styles.
        cursor.style.transform = `translate3d(calc(${x}px - 50%), calc(${y}px - 50%), 0)`;
      });
    };

    const clearBounds = () => {
      bounds = null;
    };

    syncAvailability();
    stage.addEventListener("pointermove", handlePointerMove, { capture: true, passive: true });
    document.addEventListener("visibilitychange", syncAvailability);
    reducedMotion.addEventListener("change", syncAvailability);
    finePointer.addEventListener("change", syncAvailability);
    window.addEventListener("resize", clearBounds);
    window.addEventListener("scroll", clearBounds, true);

    return () => {
      cancelFrame();
      stage.removeAttribute("data-auth-effects-paused");
      stage.removeEventListener("pointermove", handlePointerMove, { capture: true });
      document.removeEventListener("visibilitychange", syncAvailability);
      reducedMotion.removeEventListener("change", syncAvailability);
      finePointer.removeEventListener("change", syncAvailability);
      window.removeEventListener("resize", clearBounds);
      window.removeEventListener("scroll", clearBounds, true);
    };
  }, []);

  return { cursorRef, stageRef };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
