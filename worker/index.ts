import { handleRequest, getDb } from '../server/index'
import { runIndexerBatch } from '../server/indexer'

function applyEnv(env: Record<string, unknown>) {
  if (!env) return
  for (const [key, val] of Object.entries(env)) {
    if (typeof val === 'string') {
      process.env[key] = val
    }
  }
}

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    applyEnv(env)
    return handleRequest(request)
  },

  async scheduled(event: any, env: any, ctx: any): Promise<void> {
    applyEnv(env)
    const db = getDb()
    if (db) {
      ctx.waitUntil(runIndexerBatch(db))
    }
  },
}
