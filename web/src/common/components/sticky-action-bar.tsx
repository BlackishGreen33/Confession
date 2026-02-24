import React from 'react'

import { cn } from '@/utils/cn'

interface StickyActionBarProps {
  /** 左側內容 */
  left?: React.ReactNode
  /** 右側內容（操作按鈕區） */
  right?: React.ReactNode
  /** 額外的 className */
  className?: string
}

/**
 * 通用固定底部操作列
 * 用於設定頁儲存列、漏洞詳情操作列等場景
 */
export const StickyActionBar: React.FC<StickyActionBarProps> = ({ left, right, className }) => (
  <div
    className={cn(
      'glass-panel shrink-0 border-t border-cyber-border p-6',
      className,
    )}
  >
    <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
      {/* 左側 */}
      {left && <div className="hidden sm:flex sm:flex-col">{left}</div>}

      {/* 右側操作區 */}
      {right && (
        <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto sm:flex-nowrap">
          {right}
        </div>
      )}
    </div>
  </div>
)
