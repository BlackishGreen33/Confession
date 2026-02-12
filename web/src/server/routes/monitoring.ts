import { zValidator } from '@hono/zod-validator'
import { prisma } from '@server/db'
import { generateMonitoringCode } from '@server/monitoring'
import { Hono } from 'hono'
import { z } from 'zod/v4'

const generateBodySchema = z.object({
  vulnerabilityId: z.string(),
  language: z.enum(['go', 'javascript', 'typescript']),
})

export const monitoringRoutes = new Hono()

/**
 * POST /api/monitoring/generate — 產生嵌入式監測代碼
 */
monitoringRoutes.post('/generate', zValidator('json', generateBodySchema), async (c) => {
  const { vulnerabilityId, language } = c.req.valid('json')

  const vuln = await prisma.vulnerability.findUnique({ where: { id: vulnerabilityId } })
  if (!vuln) {
    return c.json({ error: '漏洞不存在' }, 404)
  }

  const result = generateMonitoringCode(
    {
      id: vuln.id,
      type: vuln.type,
      cweId: vuln.cweId,
      severity: vuln.severity,
      filePath: vuln.filePath,
      line: vuln.line,
    },
    language,
  )

  if (!result) {
    return c.json({ error: '不支援的語言' }, 400)
  }

  return c.json(result)
})
