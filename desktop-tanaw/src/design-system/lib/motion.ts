/*
 * GENERATED FILE. Do not edit; change design-system/src/lib/motion.ts instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 4e869eb0bcda28a2dc52836b7fe1275713234ea381949ae1840bb363c2b8a9ce
 */
/** Entrance used by page sections; a parent motion element orchestrates "hidden" to "visible". */
export const fadeInDown = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0 },
} as const;

/** Popovers and menus. */
export const popIn = {
  initial: { opacity: 0, y: -6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.98 },
  transition: { duration: 0.14, ease: "easeOut" },
} as const;

/** Dialog panels. */
export const dialogIn = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 12, scale: 0.98 },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;
