export const fadeInDown = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0 },
} as const;

export const staffFadeIn = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
} as const;

export const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
} as const;
