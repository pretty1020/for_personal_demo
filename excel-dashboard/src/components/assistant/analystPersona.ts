export const ASSISTANT = {
  name: 'AI Assistant',
  role: 'Capacity planning',
  team: 'Executive workspace',
} as const

export function executiveFirstName(fullName?: string | null): string {
  if (!fullName?.trim()) return 'there'
  return fullName.trim().split(/\s+/)[0] ?? 'there'
}

export function timeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function buildAnalystWelcome(executiveName?: string | null, pageLabel = 'your workspace'): string {
  const first = executiveFirstName(executiveName)
  return `${timeGreeting()}, ${first}. I'm your AI assistant.

I can see your full workspace — Planning, Capacity, Roster, Forecasting, and Financials. You're on ${pageLabel} now. Ask me about staffing, hiring, forecast models, revenue, leakage, costs, or channel-level planning (Voice, Chat, Email, etc.) — I'll explain using your actual plan data.`
}

export const ASSISTANT_QUICK_PROMPTS = [
  { label: 'Plan summary', prompt: 'Give me an executive summary of my active plan.' },
  { label: 'Staffing gap', prompt: 'Do we have enough staff for demand? Explain simply.' },
  { label: 'Understaffed channel', prompt: 'Which channel is understaffed and by how much?' },
  { label: 'Chat FTE need', prompt: 'How many FTEs are needed for Chat based on current assumptions?' },
  { label: 'AHT sensitivity', prompt: 'What happens to staffing requirements if AHT increases by 10%?' },
  { label: 'Forecast models', prompt: 'How does forecasting work in my workspace? Which models are selected and why?' },
  { label: 'Revenue outlook', prompt: 'What does my revenue outlook look like based on the plan?' },
  { label: 'Leakage drivers', prompt: 'What is driving revenue leakage in my plan? Break it down.' },
  { label: 'Highest margin', prompt: 'Which scenario or channel delivers the highest gross margin?' },
  { label: 'What changed', prompt: 'What is different between my reference plan and active plan?' },
] as const
