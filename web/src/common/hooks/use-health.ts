'use client'

import { useQuery } from '@tanstack/react-query'

import { deduplicatedGet } from '@/libs/api-client'

interface HealthResponse {
  status: string
}

/** 系統健康狀態，每 30 秒輪詢一次 */
export function useHealth() {
  const query = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: () => deduplicatedGet<HealthResponse>('/api/health'),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
  })

  const isHealthy = query.data?.status === 'ok'
  const isLoading = query.isLoading
  const isError = query.isError

  return { isHealthy, isLoading, isError }
}
