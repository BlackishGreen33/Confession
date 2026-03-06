export const MOTION_DURATIONS = {
  fast: 0.18,
  base: 0.24,
  slow: 0.32,
} as const;

export const MOTION_EASING = {
  enter: [0.22, 1, 0.36, 1] as const,
  move: [0.25, 1, 0.5, 1] as const,
} as const;

export const MOTION_STAGGER = 0.04;

/**
 * 清單項目過多時關閉逐項 stagger，避免大列表動畫造成主執行緒負擔。
 */
export const getStaggerForCount = (count: number, maxForStagger = 18): number =>
  count > maxForStagger ? 0 : MOTION_STAGGER;
