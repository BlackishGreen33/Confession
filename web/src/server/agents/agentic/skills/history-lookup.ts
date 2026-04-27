import { storage } from '@server/storage'

import type { ContextBundle, SkillExecutionRecord } from '../types'

export async function runHistoryLookupSkill(bundle: ContextBundle): Promise<SkillExecutionRecord> {
  const startedAt = Date.now()

  try {
    const rows = await storage.vulnerability.findMany({
      where: { filePath: bundle.filePath },
      select: {
        id: true,
        type: true,
        severity: true,
        status: true,
        humanStatus: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    })

    const evidence = rows.map((row) => {
      return `${row.type} severity=${row.severity} status=${row.status} human=${row.humanStatus}`
    })

    if (evidence.length === 0) {
      evidence.push('歷史紀錄：此檔案暫無漏洞記錄')
    }

    return {
      skillName: 'history_lookup',
      evidence,
      confidence: rows.length > 0 ? 0.7 : 0.35,
      cost: rows.length,
      latencyMs: Date.now() - startedAt,
      traceId: bundle.traceId,
      success: true,
    }
  } catch (err) {
    return {
      skillName: 'history_lookup',
      evidence: [],
      confidence: 0,
      cost: 0,
      latencyMs: Date.now() - startedAt,
      traceId: bundle.traceId,
      success: false,
      error: err instanceof Error ? err.message : 'history_lookup 發生未知錯誤',
    }
  }
}
