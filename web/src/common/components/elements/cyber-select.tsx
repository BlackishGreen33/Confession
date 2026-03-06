'use client'

import React from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/utils/cn'

export interface CyberSelectOption {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

interface CyberSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: CyberSelectOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  triggerClassName?: string
  contentClassName?: string
  itemClassName?: string
}

/** 以 shadcn Select 為底，統一 cyber 風格樣式覆蓋。 */
export const CyberSelect: React.FC<CyberSelectProps> = ({
  value,
  onValueChange,
  options,
  placeholder,
  disabled = false,
  id,
  triggerClassName,
  contentClassName,
  itemClassName,
}) => (
  <Select value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectTrigger
      id={id}
      className={cn(
        'w-full border-cyber-border bg-cyber-bg text-xs font-bold text-cyber-text transition-[border-color,box-shadow,background-color,color,transform,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-cyber-primary/50 focus:border-cyber-primary',
        triggerClassName,
      )}
    >
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent className={cn('border-cyber-border bg-cyber-surface', contentClassName)}>
      {options.map((option) => (
        <SelectItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn('text-xs font-semibold text-cyber-text', itemClassName)}
        >
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
)
