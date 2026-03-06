'use client';

import { m, useReducedMotion } from 'framer-motion';
import React from 'react';

import { fadeInUp } from '@/motion/variants';

interface MotionRevealProps {
  children: React.ReactNode;
  className?: string;
}

export const MotionReveal: React.FC<MotionRevealProps> = ({ children, className }) => {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <m.div initial="hidden" animate="show" variants={fadeInUp} className={className}>
      {children}
    </m.div>
  );
};
