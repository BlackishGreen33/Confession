'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { api } from '@/libs/api-client'
import { scanStatusAtom } from '@/libs/atoms'
import type { RecentScanSummary, ScanEngineMode, ScanErrorCode, ScanRequest } from '@/libs/types'

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
  engineMode: ScanEngineMode
  errorMessage: string | null
  errorCode: ScanErrorCode | null
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
  const qc = useQueryClient()
  const query = useQuery<RecentScanSummary | null>({
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
    staleTime: 800,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'running' || status === 'pending') return 1_000
      return 3_000
    },
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.EventSource) {
      return
    }

    const taskId = query.data?.id
    const status = query.data?.status
    if (!taskId || status === 'completed' || status === 'failed') {
      return
    }

    let source: { close: () => void } | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    let retryCount = 0

    const closeSource = () => {
      if (!source) return
      source.close()
      source = null
    }

    const clearReconnectTimer = () => {
      if (!reconnectTimer) return
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    const isTerminal = (value: RecentScanSummary | null | undefined): boolean =>
      value?.status === 'completed' || value?.status === 'failed'

    const getLatestSnapshot = (): RecentScanSummary | null | undefined =>
      qc.getQueryData<RecentScanSummary | null>(['scan-recent'])

    const connect = () => {
      if (disposed) return

      const latest = getLatestSnapshot()
      if (!latest || latest.id !== taskId || isTerminal(latest)) {
        return
      }

      closeSource()
      const eventSource = new window.EventSource(`/api/scan/stream/${taskId}`)
      source = eventSource

      eventSource.onmessage = (event) => {
        retryCount = 0
        clearReconnectTimer()
        handleMessage(event)
      }

      eventSource.onerror = () => {
        closeSource()
        scheduleReconnect()
      }
    }

    const scheduleReconnect = () => {
      if (disposed) return

      const latest = getLatestSnapshot()
      if (!latest || latest.id !== taskId || isTerminal(latest)) {
        return
      }

      clearReconnectTimer()
      const cappedRetry = Math.min(retryCount, 5)
      const delayMs = Math.min(10_000, 500 * 2 ** cappedRetry)
      retryCount += 1

      reconnectTimer = setTimeout(() => {
        connect()
      }, delayMs)
    }

    const handleMessage = (event: { data: string }) => {
      try {
        const next = JSON.parse(event.data) as RecentScanSummary
        if (next.id !== taskId) {
          return
        }
        qc.setQueryData<RecentScanSummary | null>(['scan-recent'], next)
        if (next.status === 'completed' || next.status === 'failed') {
          clearReconnectTimer()
          closeSource()
        }
      } catch {
        // ignore malformed payload
      }
    }

    connect()

    return () => {
      disposed = true
      clearReconnectTimer()
      closeSource()
    }
  }, [qc, query.data?.id, query.data?.status])

  return query
}
