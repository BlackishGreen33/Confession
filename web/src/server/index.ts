import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { buildHealthResponse } from './health-score'
import { configRoutes } from './routes/config'
import { exportRoutes } from './routes/export'
import { monitoringRoutes } from './routes/monitoring'
import { scanRoutes } from './routes/scan'
import { vulnerabilityRoutes } from './routes/vulnerabilities'

const app = new Hono().basePath('/api')

app.use('*', cors())

app.get('/health', async (c) => {
  const rawWindowDays = c.req.query('windowDays')
  const parsedWindowDays = rawWindowDays ? Number(rawWindowDays) : Number.NaN
  const riskWindowDays = parsedWindowDays === 7 || parsedWindowDays === 30 ? parsedWindowDays : 30

  try {
    return c.json(await buildHealthResponse(new Date(), { riskWindowDays }))
  } catch {
    const now = new Date().toISOString()
    return c.json({
      status: 'down',
      evaluatedAt: now,
      score: {
        version: 'v2',
        value: 0,
        grade: 'D',
        components: {
          exposure: { value: 0, orb: 0, lev: 0 },
          remediation: { value: 0, mttrHours: 0, closureRate: 0 },
          quality: { value: 0, efficiency: 0, coverage: 0 },
          reliability: { value: 0, successRate: 0, fallbackRate: 0, workspaceP95Ms: 0 },
        },
        topFactors: [],
      },
      engine: {},
    })
  }
})
app.route('/config', configRoutes)
app.route('/scan', scanRoutes)
app.route('/vulnerabilities', vulnerabilityRoutes)
app.route('/export', exportRoutes)
app.route('/monitoring', monitoringRoutes)

app.onError((err, c) => c.json({ error: err.message }, 500))

export { app }
export type AppType = typeof app
