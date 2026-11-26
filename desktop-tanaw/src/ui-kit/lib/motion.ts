/**
 * Shared motion for this app. Everything eases out (fast start, soft landing) and stays between
 * 150ms and 320ms. motion/react honours prefers-reduced-motion through <MotionConfig
 * reducedMotion="user"> at the app root; CSS motion is switched off by the tokens' media query.
 */

/** The app's ease-out curve, as used by CSS (`--ease-tanaw-out`). */
export const easeOut = [0.2, 0.8, 0.2, 1] as const;

/** Entrance used by page sections; a parent motion element orchestrates "hidden" to "visible". */
export const fadeInDown = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0 },
} as const;

/** Popovers and menus: a short drop with a slight scale, gone faster than it came. */
export const popIn = {
  initial: { opacity: 0, y: -4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: easeOut } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12, ease: easeOut } },
  transition: { duration: 0.18, ease: easeOut },
} as const;

/** Dialog panels: rise and settle. */
export const dialogIn = {
  initial: { opacity: 0, y: 10, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.26, ease: easeOut } },
  exit: { opacity: 0, y: 6, scale: 0.985, transition: { duration: 0.16, ease: easeOut } },
  transition: { duration: 0.26, ease: easeOut },
} as const;
