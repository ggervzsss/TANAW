import { useLayoutEffect, type RefObject } from "react";

/** Shared timing for the monitoring and settings views, so both move as one surface. */
export const CAMERA_MORPH_EASE = [0.2, 0.8, 0.2, 1] as const;
export const CAMERA_MORPH_TRANSITION = { duration: 0.28, ease: CAMERA_MORPH_EASE };

type MorphRecord = { rect: DOMRect; releasedAt: number | null };

/** The last on-screen box of each shared element, kept between the two views. */
const records = new Map<string, MorphRecord>();
/** A view that replaced another within this window morphs from it; later visits just fade in. */
const HANDOFF_WINDOW_MS = 400;

function prefersReducedMotion() {
  return typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Moves an element that both camera views show (the camera's icon and name) from where the
 * previous view drew it to where this view draws it, so opening or closing Camera Settings
 * reads as one surface changing shape rather than a page swap. Runs once per mount.
 */
export function useCameraMorph(ref: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    const previous = records.get(key);
    if (!element || !previous || previous.releasedAt === null || prefersReducedMotion()) return;
    if (performance.now() - previous.releasedAt > HANDOFF_WINDOW_MS || typeof element.animate !== "function") return;
    const next = element.getBoundingClientRect();
    if (next.width === 0 || next.height === 0) return;
    const dx = previous.rect.left - next.left;
    const dy = previous.rect.top - next.top;
    const scale = previous.rect.height / next.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) return;
    const animation = element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, transformOrigin: "top left" },
        { transform: "none", transformOrigin: "top left" },
      ],
      { duration: 320, easing: `cubic-bezier(${CAMERA_MORPH_EASE.join(", ")})` },
    );
    return () => animation.cancel();
  }, [key, ref]);

  // Record the settled box after every commit; mark it released when this view goes away.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element) records.set(key, { rect: element.getBoundingClientRect(), releasedAt: null });
  });
  useLayoutEffect(
    () => () => {
      const record = records.get(key);
      if (record) record.releasedAt = performance.now();
    },
    [key],
  );
}
