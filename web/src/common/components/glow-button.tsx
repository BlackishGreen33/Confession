import type { VariantProps } from 'class-variance-authority'
import React from 'react'

import { cn } from '@/utils/cn'

import { Button, type buttonVariants } from './ui/button'

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

/**
 * 炫光主操作按鈕
 * 基於 Button 元件，加上 cyber-primary 背景色、發光陰影和脈衝動畫
 */
export const GlowButton: React.FC<ButtonProps> = ({ className, ...props }) => {
  return (
    <Button
      className={cn(
        'bg-cyber-primary text-cyber-bg font-bold',
        'shadow-[0_8px_22px_rgba(76,141,255,0.28)]',
        'motion-emphasis hover:-translate-y-[1px] hover:shadow-[0_12px_28px_rgba(76,141,255,0.34)]',
        'active:translate-y-0 active:scale-[0.99]',
        className,
      )}
      {...props}
    />
  )
}
