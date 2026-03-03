import { app } from '@server'
import { handle } from 'hono/vercel'

// Vercel 部署：SSE 需要 Node runtime + dynamic route，並允許較長執行時間。
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const PATCH = handle(app)
export const DELETE = handle(app)
