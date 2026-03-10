import { zValidator } from '@hono/zod-validator'
import { generateMonitoringCode } from '@server/monitoring'
import { storage } from '@server/storage'
import { Hono } from 'hono'
import { z } from 'zod/v4'

const generateBodySchema = z.object({
  vulnerabilityId: z.string(),
  language: z.enum(['go', 'javascript', 'typescript']),
})

export const monitoringRoutes = new Hono()

interface MonitoringVulnerabilityRow {
  id: string
  type: string
  cweId: string | null
  severity: string
  filePath: string
  line: number
}

/**
 * POST /api/monitoring/generate — 產生嵌入式監測代碼
 */
monitoringRoutes.post('/generate', zValidator('json', generateBodySchema), async (c) => {
  const { vulnerabilityId, language } = c.req.valid('json')

  const vuln = await storage.vulnerability.findUnique({ where: { id: vulnerabilityId } })
  if (!vuln) {
    return c.json({ error: '漏洞不存在' }, 404)
  }

  const typedVuln = vuln as unknown as MonitoringVulnerabilityRow
  const result = generateMonitoringCode(
    {
      id: typedVuln.id,
      type: typedVuln.type,
      cweId: typedVuln.cweId,
      severity: typedVuln.severity,
      filePath: typedVuln.filePath,
      line: typedVuln.line,
    },
    language,
  )

  if (!result) {
    return c.json({ error: '不支援的語言' }, 400)
  }

  return c.json(result)
})
