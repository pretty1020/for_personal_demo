export type PythonDayAssignment = {
  agentIndex: number
  startMinutes: number
}

export type PythonOptimizePayload = {
  days: Array<{
    day: string
    required: Record<string, number>
    agents: number[]
  }>
  allowedStarts: number[]
  shiftLengthMinutes: number
  lockedStarts: PythonDayAssignment[]
}

export type PythonOptimizeResult = {
  ok: boolean
  engine?: string
  assignments?: Record<string, PythonDayAssignment[]>
  error?: string
}

export async function requestPythonCoverageOptimize(
  payload: PythonOptimizePayload,
): Promise<PythonOptimizeResult | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 18000)
  try {
    const response = await fetch('/api/scheduling/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const result = (await response.json()) as PythonOptimizeResult
    if (!result?.ok || !result.assignments) return null
    return result
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}
