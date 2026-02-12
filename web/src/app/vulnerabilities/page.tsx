'use client'

import { useAtom } from 'jotai'
import React, { useCallback } from 'react'

import { VulnerabilityDetail } from '@/components/vulnerability-detail'
import { VulnerabilityList } from '@/components/vulnerability-list'
import { selectedVulnIdAtom } from '@/hooks/use-vulnerabilities'

/** 漏洞列表頁：左側列表 + 選中後顯示詳情 */
const VulnerabilitiesPage: React.FC = () => {
  const [selectedId, setSelectedId] = useAtom(selectedVulnIdAtom)

  const handleBack = useCallback(() => {
    setSelectedId(null)
  }, [setSelectedId])

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-bold">漏洞列表</h1>
      {selectedId ? (
        <VulnerabilityDetail onBack={handleBack} />
      ) : (
        <VulnerabilityList />
      )}
    </main>
  )
}

export default VulnerabilitiesPage
