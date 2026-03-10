import axios from 'axios'

/**
 * API 基礎 URL：
 * - 優先使用環境變數 NEXT_PUBLIC_API_URL（支援遠程部署）
 * - 預設為本地開發伺服器
 */
function resolveBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL
  }

  // Webview / 瀏覽器端預設以當前頁面來源為準，避免設定同步打到錯誤後端。
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }

  return 'http://localhost:3000'
}

const baseURL = resolveBaseUrl()

/** 共用 Axios 實例，所有前端請求統一經由此實例發出 */
export const api = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

/**
 * GET 請求去重：相同 URL + params 的 GET 請求在進行中時，共用同一個 Promise。
 * 避免多個元件同時掛載時重複發送相同請求。
 */
const pendingGets = new Map<string, Promise<unknown>>()

export function deduplicatedGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const key = `${url}::${JSON.stringify(params ?? {})}`
  const existing = pendingGets.get(key)
  if (existing) return existing as Promise<T>

  const promise = api
    .get(url, { params })
    .then((r) => r.data as T)
    .finally(() => {
      pendingGets.delete(key)
    })

  pendingGets.set(key, promise)
  return promise
}
