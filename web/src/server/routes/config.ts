import { zValidator } from '@hono/zod-validator'
import { prisma } from '@server/db'
import { Hono } from 'hono'
import { z } from 'zod/v4'

/** 預設配置（與前端 atoms.ts 一致） */
const DEFAULT_CONFIG = {
  llm: { provider: 'gemini', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [] as string[], types: [] as string[] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
}

const configBodySchema = z.object({
  llm: z
    .object({
      provider: z.literal('gemini'),
      apiKey: z.string(),
      endpoint: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  analysis: z
    .object({
      triggerMode: z.enum(['onSave', 'manual']),
      depth: z.enum(['quick', 'standard', 'deep']),
      debounceMs: z.number().int().min(0),
    })
    .optional(),
  ignore: z
    .object({
      paths: z.array(z.string()),
      types: z.array(z.string()),
    })
    .optional(),
  api: z
    .object({
      baseUrl: z.string(),
      mode: z.enum(['local', 'remote']),
    })
    .optional(),
})

export const configRoutes = new Hono()

/**
 * GET /api/config — 取得目前配置
 */
configRoutes.get('/', async (c) => {
  const row = await prisma.config.findUnique({ where: { id: 'default' } })
  if (!row) return c.json(DEFAULT_CONFIG)
  return c.json(JSON.parse(row.data))
})

/**
 * PUT /api/config — 儲存配置（完整覆寫）
 */
configRoutes.put('/', zValidator('json', configBodySchema), async (c) => {
  const body = c.req.valid('json')

  // 讀取現有配置，合併後寫入
  const existing = await prisma.config.findUnique({ where: { id: 'default' } })
  const prev = existing ? (JSON.parse(existing.data) as typeof DEFAULT_CONFIG) : DEFAULT_CONFIG

  const merged = {
    llm: { ...prev.llm, ...body.llm },
    analysis: { ...prev.analysis, ...body.analysis },
    ignore: { ...prev.ignore, ...body.ignore },
    api: { ...prev.api, ...body.api },
  }

  await prisma.config.upsert({
    where: { id: 'default' },
    create: { id: 'default', data: JSON.stringify(merged) },
    update: { data: JSON.stringify(merged) },
  })

  return c.json(merged)
})
