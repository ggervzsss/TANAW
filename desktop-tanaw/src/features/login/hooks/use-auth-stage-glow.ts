import { type CSSProperties, useCallback, useEffect, useRef } from "react";

export const stageGlowStyle = {
  "--hero-glow-x": "28vw",
  "--hero-glow-y": "72vh",
} as CSSProperties;

export function useAuthStageGlow<TElement extends HTMLElement>() {
  const stageRef = useRef<TElement | null>(null);
  const boundsRef = useRef<DOMRect | null>(null);
  const frameRef = useRef<number | null>(null);
  const latestPositionRef = useRef({ x: 0, y: 0 });

  const updateGlowPosition = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return;

    let bounds = boundsRef.current;
    if (!bounds) {
      bounds = stage.getBoundingClientRect();
      boundsRef.current = bounds;
    }
    if (!bounds.width || !bounds.height) return;

    latestPositionRef.current = {
      x: clamp(clientX - bounds.left, 0, bounds.width),
      y: clamp(clientY - bounds.top, 0, bounds.height),
    };

    if (frameRef.current !== null) return;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const activeStage = stageRef.current;
      if (!activeStage) return;

      const { x, y } = latestPositionRef.current;
      activeStage.style.setProperty("--hero-glow-x", `${x}px`);
      activeStage.style.setProperty("--hero-glow-y", `${y}px`);
    });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch") return;
      updateGlowPosition(event.clientX, event.clientY);
    };

    const clearBounds = () => {
      boundsRef.current = null;
    };

    stage?.addEventListener("pointermove", handlePointerMove, { capture: true, passive: true });
    window.addEventListener("resize", clearBounds);
    window.addEventListener("scroll", clearBounds, true);

    return () => {
      stage?.removeEventListener("pointermove", handlePointerMove, { capture: true });
      window.removeEventListener("resize", clearBounds);
      window.removeEventListener("scroll", clearBounds, true);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [updateGlowPosition]);

  return { stageGlowStyle, stageRef };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
