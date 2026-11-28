import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * How long a skeleton waits before it shows (--tanaw-skeleton-wait in Skeleton.css). A load that
 * finishes sooner never shows one, and its content arrives without a fade.
 */
export const SKELETON_WAIT_MS = 180;

const SWEEP_ANIMATION = "tanaw-skeleton-sweep";
const REVEAL_CLASS = "tanaw-skeleton-reveal";
const REVEAL_MS = 220;
const REVEAL_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whether a skeleton that went up at `shownAt` stayed long enough to be seen. */
export function skeletonWasSeen(shownAt: number | null, at: number) {
  return shownAt !== null && at - shownAt >= SKELETON_WAIT_MS;
}

type SweepTarget = Pick<Document, "addEventListener" | "removeEventListener">;

/**
 * Puts every skeleton's sweep on one clock: when a block's sweep starts, it is moved to the
 * document timeline's origin, so a block that appears after the others (a figure still loading
 * beside a list that has arrived) lights up with the same passing band instead of its own.
 * Returns a function that stops it.
 */
export function syncSkeletonSweep(target: SweepTarget = document) {
  const align = (event: Event) => {
    if ((event as AnimationEvent).animationName !== SWEEP_ANIMATION) return;
    const element = event.target as Element | null;
    if (!element || typeof element.getAnimations !== "function") return;
    for (const animation of element.getAnimations()) {
      if ((animation as CSSAnimation).animationName === SWEEP_ANIMATION) animation.startTime = 0;
    }
  };
  target.addEventListener("animationstart", align, true);
  return () => target.removeEventListener("animationstart", align, true);
}

/**
 * The class for content that takes a skeleton's place: "tanaw-skeleton-reveal" (a short fade and
 * rise) once `loading` ends, but only when the skeleton was up long enough to be seen. A fast load
 * shows its content at once, as if it had never waited. The class goes again once the fade is
 * over, so content that re-mounts later (another camera picked, a row added) does not replay it.
 */
export function useSkeletonReveal(loading: boolean): string | undefined {
  const shownAt = useRef<number | null>(null);
  const [reveal, setReveal] = useState(false);
  useLayoutEffect(() => {
    if (loading) {
      if (shownAt.current === null) shownAt.current = now();
      setReveal(false);
      return;
    }
    const seen = skeletonWasSeen(shownAt.current, now());
    shownAt.current = null;
    if (seen) setReveal(true);
  }, [loading]);
  useEffect(() => {
    if (!reveal) return;
    const timer = window.setTimeout(() => setReveal(false), REVEAL_MS + 80);
    return () => window.clearTimeout(timer);
  }, [reveal]);
  return reveal ? REVEAL_CLASS : undefined;
}

/*
 * A Suspense fallback and the content that replaces it are different components, so the fallback
 * leaves a note when it goes: the moment it went, if it had been seen. The content takes the note
 * in the same commit.
 */
let seenScreenGoneAt: number | null = null;

/** Call in a skeleton screen used as a Suspense fallback, so SkeletonScreenReveal knows it was seen. */
export function useSkeletonScreen() {
  useLayoutEffect(() => {
    const shownAt = now();
    return () => {
      const at = now();
      seenScreenGoneAt = skeletonWasSeen(shownAt, at) ? at : null;
    };
  }, []);
}

/**
 * Rendered inside a Suspense boundary beside its content. When the boundary's skeleton screen was
 * seen, the content in `target` fades and rises in as it arrives; after a fast load it shows at once.
 */
export function SkeletonScreenReveal({ target }: { target: RefObject<HTMLElement | null> }) {
  useLayoutEffect(() => {
    const goneAt = seenScreenGoneAt;
    seenScreenGoneAt = null;
    // The note is only good for the commit that took the skeleton away.
    if (goneAt === null || now() - goneAt > 100) return;
    const element = target.current;
    if (!element || typeof element.animate !== "function") return;
    const keyframes: Keyframe[] = prefersReducedMotion()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: "translateY(4px)" },
          { opacity: 1, transform: "none" },
        ];
    const animation = element.animate(keyframes, { duration: prefersReducedMotion() ? 160 : REVEAL_MS, easing: REVEAL_EASING });
    return () => animation.cancel();
  }, [target]);
  return null;
}
