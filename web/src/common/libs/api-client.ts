import axios from 'axios'

/**
 * API 基礎 URL：
 * - 優先使用環境變數 NEXT_PUBLIC_API_URL（支援遠程部署）
 * - 預設為本地開發伺服器
 */
const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

/** 共用 Axios 實例，所有前端請求統一經由此實例發出 */
export const api = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})
