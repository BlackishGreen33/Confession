'use client'

import { useAtom } from 'jotai'
import React, { useCallback } from 'react'

import { VulnerabilityDetail } from '@/components/vulnerability-detail'
import { VulnerabilityList } from '@/components/vulnerability-list'
import { selectedVulnIdAtom } from '@/hooks/use-vulnerabilities'

/** 漏洞列表頁：左側列表 + 右側詳情（分割面板） */
const VulnerabilitiesPage: React.FC = () => {
  const [selectedId, setSelectedId] = useAtom(selectedVulnIdAtom)

  const handleClose = useCallback(() => {
    setSelectedId(null)
  }, [setSelectedId])

  return (
    <main className="flex h-full bg-cyber-bg">
      {/* 左側：漏洞列表（始終顯示） */}
      <div
        className={`h-full shrink-0 overflow-y-auto p-4 transition-all duration-300 md:p-6 ${
          selectedId ? 'w-full lg:w-[480px] lg:border-r lg:border-cyber-border' : 'w-full'
        }`}
      >
        <VulnerabilityList />
      </div>

      {/* 右側：漏洞詳情（選中時展開） */}
      {selectedId && (
        <div className="hidden h-full min-w-0 flex-1 overflow-y-auto lg:block">
          <VulnerabilityDetail onBack={handleClose} />
        </div>
      )}
    </main>
  )
}

export default VulnerabilitiesPage
