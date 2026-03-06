'use client';

import { useQuery } from '@tanstack/react-query';

import { deduplicatedGet } from '@/libs/api-client';
import type { AdviceLatestResponse } from '@/libs/types';

/** AI 建議查詢（事件驅動刷新，不做固定輪詢） */
export function useAdviceLatest(enabled = true) {
  return useQuery<AdviceLatestResponse>({
    queryKey: ['advice-latest'],
    queryFn: () => deduplicatedGet<AdviceLatestResponse>('/api/advice/latest'),
    staleTime: 60_000,
    enabled,
  });
}
