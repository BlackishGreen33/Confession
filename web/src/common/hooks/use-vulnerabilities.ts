'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, deduplicatedGet } from '@/libs/api-client'
import type { Vulnerability } from '@/libs/types'

// 從 atoms.ts 重新匯出，保持同檔共置慣例
export { selectedVulnIdAtom, vulnFiltersAtom } from '@/libs/atoms'

// === 回應型別 ===

interface VulnListResponse {
  items: Vulnerability[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface VulnStatsResponse {
  total: number
  fixRate: number
  bySeverity: Record<string, number>
  byStatus: Record<string, number>
  byHumanStatus: Record<string, number>
}

export interface TrendDataPoint {
  date: string
  total: number
  open: number
  fixed: number
  ignored: number
}

// === Hooks ===

/** 單筆漏洞查詢，30 秒內不重複請求 */
export function useVulnerability(id: string | null) {
  return useQuery<Vulnerability>({
    queryKey: ['vulnerability', id],
    queryFn: () => deduplicatedGet<Vulnerability>(`/api/vulnerabilities/${id}`),
    staleTime: 30_000,
    enabled: !!id,
  })
}

/** 漏洞列表查詢（篩選 / 排序 / 分頁），30 秒內不重複請求 */
export function useVulnerabilities(filters?: Record<string, unknown>) {
  return useQuery<VulnListResponse>({
    queryKey: ['vulnerabilities', filters],
    queryFn: () => deduplicatedGet<VulnListResponse>('/api/vulnerabilities', filters),
    staleTime: 30_000,
  })
}

/** 漏洞統計數據，30 秒內不重複請求 */
export function useVulnStats() {
  return useQuery<VulnStatsResponse>({
    queryKey: ['vuln-stats'],
    queryFn: () => deduplicatedGet<VulnStatsResponse>('/api/vulnerabilities/stats'),
    staleTime: 30_000,
  })
}

/** 更新漏洞狀態 / 歸因 */
export function useUpdateVuln() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/api/vulnerabilities/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vulnerabilities'] })
      qc.invalidateQueries({ queryKey: ['vuln-stats'] })
    },
  })
}

/** 漏洞歷史趨勢，60 秒內不重複請求 */
export function useVulnTrend() {
  return useQuery<TrendDataPoint[]>({
    queryKey: ['vuln-trend'],
    queryFn: () => deduplicatedGet<TrendDataPoint[]>('/api/vulnerabilities/trend'),
    staleTime: 60_000,
  })
}
