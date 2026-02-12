import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDebouncer } from './debounce'

/**
 * P8: Debounce 正確性（Validates: Requirements 2.7.4）
 *
 * debounce 窗口內多次保存 → 只觸發一次分析。
 */
describe('P8: Debounce 正確性', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('同一 key 在窗口內觸發 N 次，只執行一次 callback', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 50 }),
        fc.integer({ min: 50, max: 2000 }),
        (triggerCount, delayMs) => {
          const calls: string[] = []
          const debouncer = createDebouncer((key) => calls.push(key), delayMs)

          for (let i = 0; i < triggerCount; i++) {
            debouncer.trigger('file.ts')
            // 每次觸發間隔小於 delayMs，確保在窗口內
            vi.advanceTimersByTime(Math.floor(delayMs / (triggerCount + 1)))
          }

          // 推進到最後一次觸發後的完整 delay
          vi.advanceTimersByTime(delayMs + 1)

          expect(calls).toHaveLength(1)
          expect(calls[0]).toBe('file.ts')

          debouncer.clear()
        },
      ),
      { numRuns: 200 },
    )
  })

  it('不同 key 各自獨立 debounce，互不影響', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 10 }),
        fc.integer({ min: 50, max: 1000 }),
        (keys, delayMs) => {
          const calls: string[] = []
          const debouncer = createDebouncer((key) => calls.push(key), delayMs)

          // 每個 key 觸發多次
          for (let i = 0; i < 5; i++) {
            for (const key of keys) {
              debouncer.trigger(key)
            }
          }

          vi.advanceTimersByTime(delayMs + 1)

          // 每個 key 恰好觸發一次
          expect(calls).toHaveLength(keys.length)
          for (const key of keys) {
            expect(calls.filter((c) => c === key)).toHaveLength(1)
          }

          debouncer.clear()
        },
      ),
      { numRuns: 200 },
    )
  })

  it('窗口過期後再次觸發，callback 會再執行一次', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 50, max: 1000 }),
        (rounds, delayMs) => {
          const calls: string[] = []
          const debouncer = createDebouncer((key) => calls.push(key), delayMs)

          for (let r = 0; r < rounds; r++) {
            // 每輪觸發多次
            debouncer.trigger('file.ts')
            debouncer.trigger('file.ts')
            debouncer.trigger('file.ts')
            // 等待窗口完全過期
            vi.advanceTimersByTime(delayMs + 1)
          }

          expect(calls).toHaveLength(rounds)

          debouncer.clear()
        },
      ),
      { numRuns: 200 },
    )
  })
})
