/**
 * Shared motion for this app. Everything eases out (fast start, soft landing) and stays between
 * 150ms and 320ms. motion/react honours prefers-reduced-motion through <MotionConfig
 * reducedMotion="user"> at the app root; CSS motion is switched off by each stylesheet's media query.
 */

/** The app's ease-out curve, as used by CSS (`--ease-tanaw-out`). */
export const easeOut = [0.2, 0.8, 0.2, 1] as const;

/** Entrance used by page sections: a section fades up a few pixels into place. A parent motion element orchestrates "hidden" to "visible". */
export const fadeInDown = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
} as const;

/** Popovers and menus: a short drop with a slight scale, gone faster than it came. */
export const popIn = {
  initial: { opacity: 0, y: -4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: easeOut } },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12, ease: easeOut } },
  transition: { duration: 0.18, ease: easeOut },
} as const;

/**
 * Dialog panels: rise out of a soft blur and settle on a gentle spring, so the panel seems to come into
 * focus rather than appear; it leaves faster than it came. The blur is cleared to "none" afterwards so
 * the panel does not become a containing block for fixed-position content.
 */
export const dialogIn = {
  initial: { opacity: 0, y: 14, scale: 0.97, filter: "blur(4px)" },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { type: "spring", stiffness: 380, damping: 32, mass: 0.9, opacity: { duration: 0.2, ease: easeOut }, filter: { duration: 0.22, ease: easeOut } },
    transitionEnd: { filter: "none" },
  },
  exit: { opacity: 0, y: 8, scale: 0.98, filter: "blur(2px)", transition: { duration: 0.15, ease: easeOut } },
} as const;
