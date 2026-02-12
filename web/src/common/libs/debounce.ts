/**
 * 通用 per-key debounce 工具
 *
 * 與 extension/src/file-watcher.ts 中的 debounce 邏輯一致：
 * 同一 key 在 debounce 窗口內多次觸發，只有最後一次會實際執行 callback。
 */

export interface Debouncer {
  /** 觸發 debounce：若 key 已有待處理計時器則重置 */
  trigger(key: string): void
  /** 清除所有待處理計時器 */
  clear(): void
  /** 目前待處理的 key 數量 */
  readonly pendingCount: number
}

/**
 * 建立 per-key debouncer
 *
 * @param callback - 計時器到期時執行的回呼，接收 key 作為參數
 * @param delayMs - debounce 延遲毫秒數
 */
export function createDebouncer(callback: (key: string) => void, delayMs: number): Debouncer {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  return {
    trigger(key: string) {
      const existing = timers.get(key)
      if (existing) clearTimeout(existing)

      const timer = setTimeout(() => {
        timers.delete(key)
        callback(key)
      }, delayMs)

      timers.set(key, timer)
    },

    clear() {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    },

    get pendingCount() {
      return timers.size
    },
  }
}
