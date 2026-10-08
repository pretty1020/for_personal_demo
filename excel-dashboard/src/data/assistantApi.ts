import { getAssistantApiBase, getAuthToken } from './apiClient'
import { toApiAccessLevel, type AccessLevel } from '../utils/accessLevel'

export type AssistantChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AssistantApiError = {
  error?: string
  code?: string
  reply?: string
  assistant?: { openaiConfigured?: boolean; model?: string }
}

const CHAT_TIMEOUT_MS = 45_000

async function readApiJson(response: Response): Promise<AssistantApiError> {
  const text = await response.text()
  if (!text.trim()) {
    throw new Error('Assistant API returned an empty response.')
  }
  if (text.includes('FUNCTION_INVOCATION_FAILED')) {
    throw new Error(
      'Assistant API failed to start on the server. Redeploy after setting OPENAI_API_KEY in Vercel → Settings → Environment Variables.',
    )
  }
  try {
    return JSON.parse(text) as AssistantApiError
  } catch {
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 200)
    throw new Error(
      preview.startsWith('<')
        ? 'Assistant API returned HTML instead of JSON. Check that /api routes are deployed on Vercel.'
        : preview || 'Assistant API returned an invalid response.',
    )
  }
}

function formatApiError(data: AssistantApiError, fallback: string): string {
  const parts = [data.error ?? fallback]
  if (data.code) parts.push(`(${data.code})`)
  if (data.assistant && data.assistant.openaiConfigured === false) {
    parts.push('Add OPENAI_API_KEY in Vercel → Settings → Environment Variables, then redeploy.')
  }
  return parts.join(' ')
}

export async function sendAssistantMessage(input: {
  messages: AssistantChatMessage[]
  context: string
  page?: string
  executiveName?: string
  accessLevel: AccessLevel | null
  aiAssistantApproved?: boolean
}): Promise<string> {
  const base = getAssistantApiBase()
  const token = getAuthToken()
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    const response = await fetch(`${base}/assistant/chat`, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: controller.signal,
      body: JSON.stringify({
        messages: input.messages,
        context: input.context,
        page: input.page,
        executiveName: input.executiveName,
        auth: {
          accessLevel: input.accessLevel ? toApiAccessLevel(input.accessLevel) : undefined,
          aiAssistantApproved: input.aiAssistantApproved ?? false,
        },
      }),
    })

    const data = await readApiJson(response)
    if (!response.ok) {
      throw new Error(formatApiError(data, `Assistant request failed (${response.status}).`))
    }
    if (!data.reply) throw new Error('Assistant returned an empty reply.')
    return data.reply
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Assistant request timed out. Please try again.')
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function isAssistantApiAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 4000)
    try {
      const res = await fetch(`${getAssistantApiBase()}/assistant/health`, {
        signal: controller.signal,
        credentials: 'include',
      })
      if (!res.ok) return false
      const data = (await readApiJson(res)) as { assistant?: { openaiConfigured?: boolean } }
      return data.assistant?.openaiConfigured === true
    } finally {
      window.clearTimeout(timeoutId)
    }
  } catch {
    return false
  }
}

export async function fetchAssistantHealth(): Promise<{
  ok: boolean
  openaiConfigured: boolean
  model: string
  error?: string
}> {
  try {
    const res = await fetch(`${getAssistantApiBase()}/assistant/health`, { credentials: 'include' })
    const data = (await readApiJson(res)) as {
      ok?: boolean
      assistant?: { openaiConfigured?: boolean; model?: string }
      error?: string
    }
    return {
      ok: res.ok && data.ok === true,
      openaiConfigured: data.assistant?.openaiConfigured === true,
      model: data.assistant?.model ?? 'gpt-4o-mini',
      error: data.error,
    }
  } catch (error) {
    return {
      ok: false,
      openaiConfigured: false,
      model: 'gpt-4o-mini',
      error: error instanceof Error ? error.message : 'Assistant health check failed.',
    }
  }
}
