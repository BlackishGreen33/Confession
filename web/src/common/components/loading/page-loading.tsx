'use client';

import { m, useReducedMotion } from 'framer-motion';
import React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { MOTION_DURATIONS, MOTION_EASING } from '@/motion/tokens';

interface PageLoadingProps {
  title: string;
  subtitle?: string;
}

export const PageLoading: React.FC<PageLoadingProps> = ({ title, subtitle }) => {
  const reduceMotion = useReducedMotion();

  return (
    <main className="h-full overflow-y-auto bg-cyber-bg">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-4 p-6 md:p-8">
        <m.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: MOTION_DURATIONS.base, ease: MOTION_EASING.enter }
          }
          className="space-y-2"
        >
          <p className="text-xs font-black tracking-[0.08em] text-cyber-textmuted uppercase">{title}</p>
          {subtitle ? <p className="text-sm text-cyber-textmuted">{subtitle}</p> : null}
        </m.div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <m.div
              key={idx}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      duration: MOTION_DURATIONS.base,
                      ease: MOTION_EASING.enter,
                      delay: idx * 0.04,
                    }
              }
            >
              <Skeleton className="h-36 border border-cyber-border/60 bg-cyber-surface" />
            </m.div>
          ))}
        </div>

        <Skeleton className="h-14 border border-cyber-border/60 bg-cyber-surface" />
        <Skeleton className="h-[360px] border border-cyber-border/60 bg-cyber-surface" />
      </div>
    </main>
  );
};
