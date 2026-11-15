import { flushSync } from "react-dom";

// One compositor timeline covers solid colors, gradients, SVGs, images and portals.
// Component hover/press/layout animations remain owned by their components.
type ThemeTransition = { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void };
type TransitionDocument = Document & { startViewTransition?: (update: () => void) => ThemeTransition };
let active: ThemeTransition | undefined;
let sequence = 0;

export function transitionTheme(update: () => void, animate: boolean) {
  const id = ++sequence;
  active?.skipTransition();
  active = undefined;
  const root = document.documentElement;
  const clear = () => {
    if (id !== sequence) return;
    delete root.dataset.themeCommit;
    delete root.dataset.themeTransition;
    active = undefined;
  };
  // Disable local color tweens during capture, including inherited-color chains.
  // This is removed after capture; existing interaction animations are not replaced.
  root.dataset.themeCommit = "true";
  const commit = () => {
    if (id === sequence) flushSync(update);
  };
  const atomicCleanup = () => {
    if (id !== sequence) return;
    delete root.dataset.themeTransition;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(clear));
    else clear();
  };
  const documentWithTransitions = document as TransitionDocument;
  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !documentWithTransitions.startViewTransition || document.visibilityState === "hidden") {
    commit();
    // Keep the commit rule through style resolution so pre-existing CSS transitions
    // cannot start a delayed color tween after an atomic/reduced-motion update.
    atomicCleanup();
    return;
  }
  root.dataset.themeTransition = "snapshot";
  let committed = false;
  let atomicFallback = false;
  try {
    const transition = documentWithTransitions.startViewTransition(() => {
      commit();
      committed = true;
    });
    active = transition;
    void transition.ready.then(
      () => {
        if (id === sequence) delete root.dataset.themeCommit;
      },
      () => {
        atomicFallback = true;
        atomicCleanup();
      },
    );
    void transition.finished
      .catch(() => {
        if (!committed) commit();
        atomicFallback = true;
        atomicCleanup();
      })
      .finally(() => {
        if (!atomicFallback) clear();
      });
  } catch {
    commit();
    atomicCleanup();
  }
}
