import type { VercelRequest, VercelResponse } from '@vercel/node'
import { callOpenAiChat, getOpenAiConfigStatus, trimContext, type ChatMessage } from '../_lib/assistantCore.js'
import { loadProjectEnvLocal } from '../_lib/loadProjectEnv.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'

type AssistantAuth = {
  accessLevel?: 'executive' | 'manager'
  aiAssistantApproved?: boolean
}

type ChatRequestBody = {
  messages?: ChatMessage[]
  context?: string
  page?: string
  executiveName?: string
  auth?: AssistantAuth
}

function parseJsonBody(req: VercelRequest): ChatRequestBody | null {
  const raw = req.body
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as ChatRequestBody
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw) as ChatRequestBody
    } catch {
      return null
    }
  }
  return null
}

function isClientAuthorized(auth?: AssistantAuth): boolean {
  return auth?.accessLevel === 'executive' || auth?.aiAssistantApproved === true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(req, res)
    if (handleOptions(req, res)) return

    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
      return
    }

    loadProjectEnvLocal(['OPENAI_API_KEY', 'OPENAI_MODEL'])
    const apiKey = process.env.OPENAI_API_KEY?.trim()
    if (!apiKey) {
      json(res, 503, {
        error:
          process.env.VERCEL
            ? 'OPENAI_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables, then redeploy.'
            : 'OPENAI_API_KEY is not set on the server. Add it to excel-dashboard/.env.local and restart `npm run dev:api`.',
        code: 'missing_openai_key',
        assistant: getOpenAiConfigStatus(),
      })
      return
    }

    const body = parseJsonBody(req)
    if (!body) {
      json(res, 400, { error: 'Request body must be valid JSON.', code: 'invalid_json' })
      return
    }

    if (!isClientAuthorized(body.auth)) {
      json(res, 403, {
        error: 'AI Assistant is available to executives or admin-approved users only.',
        code: 'forbidden',
      })
      return
    }

    const messages = Array.isArray(body.messages) ? body.messages : []
    const context = typeof body.context === 'string' ? body.context : ''
    if (!context.trim()) {
      json(res, 400, { error: 'App context is required.', code: 'missing_context' })
      return
    }
    if (!messages.length || messages[messages.length - 1]?.role !== 'user') {
      json(res, 400, { error: 'Include at least one user message.', code: 'invalid_messages' })
      return
    }

    const pageNote = body.page ? `\n\nUser is currently viewing: ${body.page}` : ''
    const reply = await callOpenAiChat(apiKey, trimContext(`${context}${pageNote}`), messages, {
      executiveName: body.executiveName,
      page: body.page,
    })

    json(res, 200, { reply })
  } catch (error) {
    console.error('Assistant chat handler failed:', error)
    const message = error instanceof Error ? error.message : 'Assistant handler failed unexpectedly.'
    json(res, 500, {
      error: message,
      code: 'handler_error',
      assistant: getOpenAiConfigStatus(),
    })
  }
}
