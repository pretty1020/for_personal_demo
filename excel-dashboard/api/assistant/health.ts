import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getOpenAiConfigStatus } from '../_lib/assistantCore.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(req, res)
    if (handleOptions(req, res)) return

    if (req.method !== 'GET') {
      json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
      return
    }

    const assistant = getOpenAiConfigStatus()
    json(res, 200, {
      ok: assistant.openaiConfigured,
      assistant,
    })
  } catch (error) {
    console.error('Assistant health check failed:', error)
    json(res, 500, {
      ok: false,
      error: 'Assistant health check failed.',
      code: 'health_error',
      assistant: { openaiConfigured: false, model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini' },
    })
  }
}
