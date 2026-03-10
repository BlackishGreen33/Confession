import type { UpsertStorageMetrics } from '@server/storage'

export const USER_CANCELED_MESSAGE = '使用者已取消掃描'
export const SUPERSEDED_BY_NEW_SCAN_MESSAGE = '新掃描任務已啟動，上一個掃描已中止'
export const WORKSPACE_SNAPSHOT_AUTO_FIXED_MESSAGE =
  '來源檔案未出現在本次工作區快照，已自動標記為 fixed（可能已刪除或改名）'

export const PROGRESS_FLUSH_INTERVAL_MS = 2_000
export const PROGRESS_FLUSH_FILE_STEP = 20
export const SSE_KEEPALIVE_MS = 15_000

export const NO_STORAGE_METRICS: UpsertStorageMetrics = {
  fs_write_ops_per_scan: 0,
  db_lock_wait_ms_p95: 0,
  db_lock_hold_ms_p95: 0,
  db_lock_timeout_count: 0,
}
