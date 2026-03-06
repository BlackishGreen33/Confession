'use client';

import { useQuery } from '@tanstack/react-query';

import { deduplicatedGet } from '@/libs/api-client';
import type { HealthResponseV2 } from '@/libs/types';

/** 系統健康狀態（事件驅動刷新，不做固定輪詢） */
export function useHealth(windowDays: 7 | 30 = 30, enabled = true) {
  const query = useQuery<HealthResponseV2>({
    queryKey: ['health', windowDays],
    queryFn: () =>
      deduplicatedGet<HealthResponseV2>(`/api/health?windowDays=${windowDays}`),
    enabled,
    staleTime: 15_000,
    retry: 1,
  });

  const isHealthy = query.data?.status === 'ok';
  const isLoading = query.isLoading;
  const isError = query.isError;

  return { isHealthy, isLoading, isError, health: query.data, query };
}
