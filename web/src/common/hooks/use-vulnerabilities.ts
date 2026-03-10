'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, deduplicatedGet } from '@/libs/api-client';
import type { Vulnerability, VulnerabilityEvent } from '@/libs/types';

// === 回應型別 ===

interface VulnListResponse {
  items: Vulnerability[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface VulnStatsResponse {
  total: number;
  fixRate: number;
  bySeverity: Record<string, number>;
  bySeverityOpen?: Record<string, number>;
  byStatus: Record<string, number>;
  byHumanStatus: Record<string, number>;
}

export interface TrendDataPoint {
  date: string;
  total: number;
  open: number;
  fixed: number;
  ignored: number;
}

interface VulnerabilityEventsQuery {
  limit?: number;
}

// === Hooks ===

/** 單筆漏洞查詢，30 秒內不重複請求 */
export function useVulnerability(id: string | null) {
  return useQuery<Vulnerability>({
    queryKey: ['vulnerability', id],
    queryFn: () => deduplicatedGet<Vulnerability>(`/api/vulnerabilities/${id}`),
    staleTime: 30_000,
    enabled: !!id,
  });
}

/** 單筆漏洞事件流查詢（新到舊） */
export function useVulnerabilityEvents(
  id: string | null,
  query?: VulnerabilityEventsQuery
) {
  return useQuery<VulnerabilityEvent[]>({
    queryKey: ['vulnerability-events', id, query?.limit ?? 20],
    queryFn: () =>
      deduplicatedGet<VulnerabilityEvent[]>(
        `/api/vulnerabilities/${id}/events`,
        {
          limit: query?.limit ?? 20,
        }
      ),
    staleTime: 15_000,
    enabled: !!id,
  });
}

/** 漏洞列表查詢（篩選 / 排序 / 分頁），30 秒內不重複請求 */
export function useVulnerabilities(filters?: Record<string, unknown>) {
  return useQuery<VulnListResponse>({
    queryKey: ['vulnerabilities', filters],
    queryFn: () =>
      deduplicatedGet<VulnListResponse>('/api/vulnerabilities', filters),
    staleTime: 30_000,
  });
}

/** 漏洞統計數據，30 秒內不重複請求 */
export function useVulnStats() {
  return useQuery<VulnStatsResponse>({
    queryKey: ['vuln-stats'],
    queryFn: () =>
      deduplicatedGet<VulnStatsResponse>('/api/vulnerabilities/stats'),
    staleTime: 30_000,
  });
}

/** 更新漏洞狀態 / 歸因 */
export function useUpdateVuln() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) => {
      const res = await api.patch<Vulnerability>(
        `/api/vulnerabilities/${id}`,
        data
      );
      return res.data;
    },
    onSuccess: (updated) => {
      // 同步單筆快取，避免詳情頁 Select 顯示舊值造成「看起來無法修改」
      qc.setQueryData<Vulnerability>(['vulnerability', updated.id], updated);
      qc.setQueriesData<VulnListResponse>(
        { queryKey: ['vulnerabilities'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === updated.id ? updated : item
            ),
          };
        }
      );
      // 讓含狀態篩選/分頁的列表也能立刻重算，避免殘留舊項目
      void qc.invalidateQueries({ queryKey: ['vulnerabilities'] });
      qc.invalidateQueries({ queryKey: ['vuln-stats'] });
      qc.invalidateQueries({ queryKey: ['vuln-trend'] });
      qc.invalidateQueries({ queryKey: ['health'] });
      qc.invalidateQueries({ queryKey: ['advice-latest'] });
      void qc.invalidateQueries({
        queryKey: ['vulnerability-events', updated.id],
      });
    },
  });
}

/** 漏洞歷史趨勢，60 秒內不重複請求 */
export function useVulnTrend() {
  return useQuery<TrendDataPoint[]>({
    queryKey: ['vuln-trend'],
    queryFn: () =>
      deduplicatedGet<TrendDataPoint[]>('/api/vulnerabilities/trend'),
    staleTime: 60_000,
  });
}
