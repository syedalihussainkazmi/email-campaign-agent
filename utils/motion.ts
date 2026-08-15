import type { Variants, Transition } from "framer-motion";

/** One shared rhythm for every animation in the app - durations in the 150-300ms
 * micro-interaction range, exit faster than enter (~65%) so dismissal feels snappy. */
export const MOTION_DURATION = {
  fast: 0.15,
  base: 0.2,
} as const;

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN = [0.7, 0, 0.84, 0] as const;

/** Panels fade + rise slightly on enter, fade out faster on exit. */
export const panelVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: MOTION_DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, y: 4, transition: { duration: MOTION_DURATION.fast, ease: EASE_IN } },
};

export const progressBarTransition: Transition = { duration: 0.5, ease: EASE_OUT };

/** Parent wrapper for a list of cards — staggers children in on mount. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

/** Individual list item entrance, used inside a staggerContainer. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: MOTION_DURATION.base, ease: EASE_OUT } },
};
