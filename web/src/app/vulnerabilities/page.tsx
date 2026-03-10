'use client'

import React from 'react'

import { VulnerabilityList } from '@/components/vulnerability-list/main'
import { MotionReveal } from '@/motion/reveal'

/** 漏洞列表頁：純列表，詳情由 Editor_Panel 獨立 webview 顯示 */
const VulnerabilitiesPage: React.FC = () => {
  return (
    <main className="h-full overflow-y-auto bg-cyber-bg p-4 md:p-6">
      <div className="mx-auto w-full max-w-[1320px]">
        <MotionReveal>
          <VulnerabilityList />
        </MotionReveal>
      </div>
    </main>
  )
}

export default VulnerabilitiesPage
