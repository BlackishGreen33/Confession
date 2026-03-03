'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useRef } from 'react'

import { configAtom, scanStatusAtom, vulnerabilityDetailAtom } from '@/libs/atoms'
import type { ExtToWebMsg, PluginConfig, WebToExtMsg } from '@/libs/types'

/** 判斷是否在 VS Code Webview iframe 內 */
function isInVscodeWebview(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window
  } catch {
    return false
  }
}

/** 向擴充套件發送訊息（透過 parent window 轉發） */
export function postToExtension(msg: WebToExtMsg): void {
  if (isInVscodeWebview()) {
    window.parent.postMessage(msg, '*')
  }
}

/** 向擴充套件發送開啟漏洞詳情請求 */
export function sendOpenVulnerabilityDetail(vulnId: string): void {
  postToExtension({ type: 'open_vulnerability_detail', data: { vulnerabilityId: vulnId } })
}

/**
 * 擴充套件橋接 hook：
 * - 監聽 config_updated 訊息，同步到 configAtom
 * - 監聽 navigate_to_view 訊息，呼叫 router.push 切換路由
 * - 監聽 vulnerability_detail_data 訊息，寫入 vulnerabilityDetailAtom
 * - 監聽 scan_progress 訊息，同步到 scanStatusAtom
 * - 監聽 vulnerabilities_updated 訊息，觸發漏洞相關查詢刷新
 * - 提供 sendConfigToExtension 將設定變更寫回 VS Code
 * - 啟動時向擴充套件請求目前配置
 */
export function useExtensionBridge() {
  const setConfig = useSetAtom(configAtom)
  const setScanStatus = useSetAtom(scanStatusAtom)
  const setVulnDetail = useSetAtom(vulnerabilityDetailAtom)
  const queryClient = useQueryClient()
  const router = useRouter()
  const initializedRef = useRef(false)

  useEffect(() => {
    const handler = (event: MessageEvent<ExtToWebMsg>) => {
      const msg = event.data
      if (!msg?.type) return

      switch (msg.type) {
        case 'config_updated':
          setConfig(msg.data)
          break
        case 'navigate_to_view':
          router.push(msg.data.route)
          break
        case 'vulnerability_detail_data':
          setVulnDetail(msg.data)
          break
        case 'scan_progress':
          setScanStatus({
            isScanning: msg.data.status === 'running',
            progress: msg.data.progress,
            message:
              msg.data.status === 'completed'
                ? '掃描完成'
                : msg.data.status === 'failed'
                  ? '掃描失敗'
                  : '掃描進行中…',
          })
          break
        case 'vulnerabilities_updated':
          void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] })
          void queryClient.invalidateQueries({ queryKey: ['vuln-stats'] })
          void queryClient.invalidateQueries({ queryKey: ['vuln-trend'] })
          break
      }
    }

    window.addEventListener('message', handler)

    // 首次掛載時向擴充套件請求目前配置
    if (!initializedRef.current && isInVscodeWebview()) {
      initializedRef.current = true
      postToExtension({ type: 'request_config' })
    }

    return () => window.removeEventListener('message', handler)
  }, [queryClient, router, setConfig, setScanStatus, setVulnDetail])

  const sendConfigToExtension = useCallback((config: PluginConfig) => {
    postToExtension({ type: 'update_config', data: config })
  }, [])

  return { sendConfigToExtension, isInVscodeWebview: isInVscodeWebview() }
}

/** 無 UI 初始化元件，掛載於 Providers 內以啟動橋接監聽 */
export const ExtensionBridgeInit: React.FC = () => {
  useExtensionBridge()
  return null
}
