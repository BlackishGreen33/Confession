'use client'

import React from 'react'

import { SettingsPanel } from '@/components/settings/main'
import { MotionReveal } from '@/motion/reveal'

/** 設定頁 — 使用 h-dvh 直接撐滿視窗，不依賴父層高度鏈 */
const SettingsPage: React.FC = () => {
  return (
    <main className="flex h-dvh flex-col bg-cyber-bg">
      <MotionReveal className="h-full">
        <SettingsPanel />
      </MotionReveal>
    </main>
  )
}

export default SettingsPage
