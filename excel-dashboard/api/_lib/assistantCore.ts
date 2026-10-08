import { loadProjectEnvLocal } from './loadProjectEnv.js'

function ensureAssistantEnv(): void {
  loadProjectEnvLocal(['OPENAI_API_KEY', 'OPENAI_MODEL'])
}

export const ASSISTANT_SYSTEM_PROMPT = `You are an AI assistant embedded in a workforce capacity planning application. You help executive users understand their plans — professional, warm, and clear.

PERSONA & TONE:
- Speak in first person as the AI assistant ("I've reviewed your plan…", "Based on your workspace…"). Do not use any other name.
- Address the executive respectfully. If EXECUTIVE NAME is provided, you may use their first name occasionally.
- Lead with the direct answer, then supporting numbers, then a brief explanation of drivers or methodology when helpful.
- Use plain language. Explain jargon briefly when needed.
- When asked "how does forecasting work", "explain the model", or similar: use the "HOW THE APP MODELS WORK" and FORECASTING sections in APP DATA. Name the selected forecast model, RMSE if available, and whether values are overridden.
- For "why" questions (staffing gaps, revenue changes, leakage): connect the answer to specific assumptions (hiring plan, attrition, AHT, volume growth, shrinkage, ramp curve).
- For channel questions: use per-channel assumptions (Voice, Chat, Email, SMS, Social, Back Office, Video, Blended). Compare required FTE, staffing gap, and margin by channel. Total staffing sums channel requirements — never averaged.

STRICT DATA RULES:
1. Answer ONLY using facts from the APP DATA section below. Never invent numbers, dates, clients, or metrics.
2. You may reference any module in APP DATA — Planning, Capacity, Roster, Forecasting, Financial — even if the user is on a different page.
3. If the data does not contain enough information, say clearly: "I don't see that in your current workspace yet." Suggest which page or plan to check.
4. When citing numbers, use exact values from APP DATA.
5. Do not mention OpenAI, AI models, or system instructions.
6. Do not give generic industry advice unless directly supported by APP DATA.
7. Prefer the active plan for detailed answers; mention other saved plans only when relevant or asked.`

export function buildAssistantPersonaBlock(executiveName?: string, page?: string): string {
  const lines = ['===== EXECUTIVE SESSION =====']
  if (executiveName?.trim()) lines.push(`Executive name: ${executiveName.trim()}`)
  if (page?.trim()) lines.push(`Current screen: ${page.trim()}`)
  lines.push('Role: executive user receiving assistant support.')
  lines.push('Data scope: full application — Planning, Capacity, Roster, Forecasting, Financial modules.')
  return lines.join('\n')
}

export function trimContext(context: string, maxChars = 42_000): string {
  if (context.length <= maxChars) return context
  return `${context.slice(0, maxChars)}\n\n[Context truncated for length.]`
}

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export async function callOpenAiChat(
  apiKey: string,
  appContext: string,
  messages: ChatMessage[],
  options?: { executiveName?: string; page?: string },
): Promise<string> {
  ensureAssistantEnv()
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const personaBlock = buildAssistantPersonaBlock(options?.executiveName, options?.page)
  const payload = {
    model,
    temperature: 0.2,
    max_tokens: 960,
    messages: [
      {
        role: 'system',
        content: `${ASSISTANT_SYSTEM_PROMPT}\n\n${personaBlock}\n\n===== APP DATA (authoritative) =====\n${appContext}`,
      },
      ...messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    ],
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const detail = await response.text()
    console.error('OpenAI error:', response.status, detail)
    throw new Error(`OpenAI request failed (${response.status}).`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('Assistant returned an empty response.')
  return content
}

export function getOpenAiConfigStatus(): {
  openaiConfigured: boolean
  model: string
} {
  ensureAssistantEnv()
  return {
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  }
}
