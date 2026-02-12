import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { exportRoutes } from './routes/export'
import { scanRoutes } from './routes/scan'
import { vulnerabilityRoutes } from './routes/vulnerabilities'

const app = new Hono().basePath('/api')

app.use('*', cors())

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/scan', scanRoutes)
app.route('/vulnerabilities', vulnerabilityRoutes)
app.route('/export', exportRoutes)

app.onError((err, c) => c.json({ error: err.message }, 500))

export { app }
export type AppType = typeof app
