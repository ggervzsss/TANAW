import { flushSync } from "react-dom";
import type { ResolvedTheme } from "./theme";

type ThemePreparation = (theme: ResolvedTheme) => Promise<(() => void) | undefined>;
let prepareTheme: ThemePreparation | undefined;

export function registerThemePreparation(prepare: ThemePreparation) {
  prepareTheme = prepare;
  return () => {
    if (prepareTheme === prepare) prepareTheme = undefined;
  };
}

export async function transitionPortalTheme(theme: ResolvedTheme, apply: () => void) {
  const commitPreparedTheme = await prepareTheme?.(theme);
  const root = document.documentElement;
  const commit = () =>
    flushSync(() => {
      apply();
      commitPreparedTheme?.();
    });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    commit();
    return;
  }

  if (!document.startViewTransition) {
    root.dataset.portalThemeTransition = "fallback";
    // Resolve existing colors with the shared transition rules before switching tokens.
    document.body.getBoundingClientRect();
    try {
      commit();
    } finally {
      window.setTimeout(() => delete root.dataset.portalThemeTransition, 220);
    }
    return;
  }

  root.dataset.portalThemeTransition = "snapshot";
  try {
    await document.startViewTransition(commit).finished;
  } finally {
    delete root.dataset.portalThemeTransition;
  }
}
