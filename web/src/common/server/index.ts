import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono().basePath('/api')

app.use('*', cors())

// 路由佔位 — 待路由模組實作後替換
app.get('/health', (c) => c.json({ status: 'ok' }))

app.onError((err, c) => c.json({ error: err.message }, 500))

export { app }
export type AppType = typeof app
