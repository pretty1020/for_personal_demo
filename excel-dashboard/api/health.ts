import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getOpenAiConfigStatus } from './_lib/assistantCore.js'

type ServiceStatus = 'configured' | 'missing_config' | 'connected' | 'error'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const assistantStatus = getOpenAiConfigStatus()
    const assistant: ServiceStatus = assistantStatus.openaiConfigured ? 'configured' : 'missing_config'
    let database: ServiceStatus = 'missing_config'

    if (process.env.DATABASE_URL) {
      try {
        const { getDb } = await import('./_lib/db.js')
        const sql = getDb()
        await sql`SELECT 1 AS ok`
        database = 'connected'
      } catch (error) {
        console.error('Database health check failed:', error)
        database = 'error'
      }
    }

    res.status(200).json({
      ok: assistant === 'configured' || database === 'connected',
      assistant,
      database,
      auth: database === 'connected' ? 'database' : 'demo',
      debug: {
        assistant: assistantStatus,
      },
    })
  } catch (error) {
    console.error('Health handler failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Health check failed.',
      code: 'health_error',
      debug: {
        assistant: getOpenAiConfigStatus(),
      },
    })
  }
}
