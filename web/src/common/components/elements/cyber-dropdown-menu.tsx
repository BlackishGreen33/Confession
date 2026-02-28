'use client'

import React from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/utils/cn'

interface CyberDropdownItem {
  key: string
  label: string
  onSelect: () => void
  disabled?: boolean
  icon?: React.ReactNode
  className?: string
}

interface CyberDropdownMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactNode
  items: CyberDropdownItem[]
  contentClassName?: string
}

/** 共用 cyber 風格下拉選單，統一 portal 與項目樣式。 */
export const CyberDropdownMenu: React.FC<CyberDropdownMenuProps> = ({
  open,
  onOpenChange,
  trigger,
  items,
  contentClassName,
}) => (
  <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
    <DropdownMenuContent
      className={cn(
        'rounded-xl border-cyber-primary/40 bg-cyber-surface p-0 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl',
        contentClassName,
      )}
    >
      {items.map((item, index) => (
        <DropdownMenuItem
          key={item.key}
          disabled={item.disabled}
          onSelect={item.onSelect}
          className={cn(
            'cursor-pointer rounded-none px-4 py-3 text-[11px] font-bold text-white transition-all hover:bg-cyber-primary/10 hover:text-cyber-primary focus:bg-cyber-primary/10 focus:text-cyber-primary',
            index < items.length - 1 && 'border-b border-cyber-border/50',
            item.className,
          )}
        >
          {item.icon}
          {item.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
)
