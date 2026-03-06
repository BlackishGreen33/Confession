'use client';

import { domAnimation,LazyMotion, MotionConfig } from 'framer-motion';
import React from 'react';

import { MOTION_DURATIONS, MOTION_EASING } from '@/motion/tokens';

interface MotionProviderProps {
  children: React.ReactNode;
}

/**
 * 全域動效 Provider：
 * - 使用 LazyMotion 降低初始載入成本
 * - 統一 transition token
 * - reducedMotion="user" 尊重使用者系統偏好
 */
export const MotionProvider: React.FC<MotionProviderProps> = ({ children }) => {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: MOTION_DURATIONS.base, ease: MOTION_EASING.enter }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
};
