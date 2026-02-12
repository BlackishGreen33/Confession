'use client'

import React from 'react'

import { SettingsPanel } from '@/components/settings-panel'

/** 設定頁 */
const SettingsPage: React.FC = () => {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-bold">設定</h1>
      <SettingsPanel />
    </main>
  )
}

export default SettingsPage
