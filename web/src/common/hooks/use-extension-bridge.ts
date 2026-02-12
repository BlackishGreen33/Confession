'use client'

import { useSetAtom } from 'jotai'
import React, { useCallback, useEffect, useRef } from 'react'

import { configAtom } from '@/libs/atoms'
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
function postToExtension(msg: WebToExtMsg): void {
  if (isInVscodeWebview()) {
    window.parent.postMessage(msg, '*')
  }
}

/**
 * 擴充套件橋接 hook：
 * - 監聽來自擴充套件的 config_updated 訊息，同步到 Jotai atom
 * - 提供 sendConfigToExtension 將設定面板的變更寫回 VS Code settings.json
 * - 啟動時向擴充套件請求目前配置
 */
export function useExtensionBridge() {
  const setConfig = useSetAtom(configAtom)
  const initializedRef = useRef(false)

  useEffect(() => {
    const handler = (event: MessageEvent<ExtToWebMsg>) => {
      if (event.data?.type === 'config_updated') {
        setConfig(event.data.data)
      }
    }

    window.addEventListener('message', handler)

    // 首次掛載時向擴充套件請求目前配置
    if (!initializedRef.current && isInVscodeWebview()) {
      initializedRef.current = true
      postToExtension({ type: 'request_config' })
    }

    return () => window.removeEventListener('message', handler)
  }, [setConfig])

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
