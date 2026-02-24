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
        'bg-cyber-primary text-cyber-bg font-black',
        'shadow-[0_0_30px_rgba(88,166,255,0.4)]',
        'hover:shadow-[0_0_40px_rgba(88,166,255,0.6)]',
        'animate-pulse-glow',
        className,
      )}
      {...props}
    />
  )
}
