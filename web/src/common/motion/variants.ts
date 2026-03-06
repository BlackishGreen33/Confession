import type { Variants } from 'framer-motion';

import { MOTION_DURATIONS, MOTION_EASING } from '@/motion/tokens';

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: MOTION_DURATIONS.base,
      ease: MOTION_EASING.enter,
    },
  },
};

export const fadeOnly: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      duration: MOTION_DURATIONS.fast,
      ease: 'linear',
    },
  },
};

export const sectionContainer = (staggerChildren: number): Variants => ({
  hidden: {},
  show: {
    transition: {
      staggerChildren,
      delayChildren: 0.02,
    },
  },
});

export const panelEnter: Variants = {
  hidden: { opacity: 0, scale: 0.985, y: 8 },
  show: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: MOTION_DURATIONS.base,
      ease: MOTION_EASING.enter,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.99,
    y: 4,
    transition: {
      duration: MOTION_DURATIONS.fast,
      ease: MOTION_EASING.enter,
    },
  },
};
