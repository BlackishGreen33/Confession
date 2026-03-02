'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { useSetAtom } from 'jotai'

import { api } from '@/libs/api-client'
import { scanStatusAtom } from '@/libs/atoms'
import type { RecentScanSummary, ScanRequest } from '@/libs/types'

// 從 atoms.ts 重新匯出，保持同檔共置慣例
export { scanStatusAtom } from '@/libs/atoms'

// === 回應型別 ===

interface ScanTriggerResponse {
  taskId: string
  status: string
}

export interface ScanStatusResponse {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  totalFiles: number
  scannedFiles: number
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

// === Hooks ===

/** 觸發掃描（POST /api/scan） */
export function useScan() {
  const qc = useQueryClient()
  const setScanStatus = useSetAtom(scanStatusAtom)

  return useMutation<ScanTriggerResponse, Error, ScanRequest>({
    mutationFn: (request) => api.post('/api/scan', request).then((r) => r.data),
    onMutate: () => {
      setScanStatus({ isScanning: true, progress: 0, message: '掃描啟動中…' })
    },
    onSuccess: () => {
      setScanStatus({ isScanning: true, progress: 0.1, message: '掃描進行中…' })
    },
    onError: (error) => {
      setScanStatus({ isScanning: false, progress: 0, message: error.message })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['vulnerabilities'] })
      qc.invalidateQueries({ queryKey: ['vuln-stats'] })
    },
  })
}

/** 查詢掃描進度（GET /api/scan/status/:id） */
export function useScanStatus(taskId: string | null) {
  return useQuery<ScanStatusResponse>({
    queryKey: ['scan-status', taskId],
    queryFn: () => api.get(`/api/scan/status/${taskId}`).then((r) => r.data),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // 掃描完成或失敗後停止輪詢
      if (status === 'completed' || status === 'failed') return false
      return 1000
    },
  })
}

/** 查詢最近一次掃描摘要（GET /api/scan/recent） */
export function useRecentScanSummary() {
  return useQuery<RecentScanSummary | null>({
    queryKey: ['scan-recent'],
    queryFn: async () => {
      try {
        const res = await api.get<RecentScanSummary>('/api/scan/recent')
        return res.data
      } catch (err) {
        if (err instanceof AxiosError && err.response?.status === 404) {
          return null
        }
        throw err
      }
    },
    retry: false,
    staleTime: 1_500,
    refetchInterval: 3_000,
  })
}
