import type { VercelRequest, VercelResponse } from '@vercel/node'
import { mariadbReady, pingMariaDb } from './_lib/db.js'

type ServiceStatus = 'missing_config' | 'connected' | 'error'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    let database: ServiceStatus = 'missing_config'

    if (mariadbReady()) {
      database = (await pingMariaDb()) ? 'connected' : 'error'
    }

    res.status(200).json({
      ok: database === 'connected',
      database,
      auth: database === 'connected' ? 'database' : 'demo',
    })
  } catch (error) {
    console.error('Health handler failed:', error)
    res.status(500).json({
      ok: false,
      error: 'Health check failed.',
      code: 'health_error',
    })
  }
}
