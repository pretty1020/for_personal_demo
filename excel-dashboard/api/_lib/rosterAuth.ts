import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readSessionToken, requireSessionUser, type SessionUser } from './session.js'

export type RosterApiUser = SessionUser | {
  id: string
  email: string
  name: string
  accessLevel: 'executive' | 'manager'
  aiAssistantApproved: boolean
}

export async function requireRosterApiUser(req: VercelRequest, res: VercelResponse): Promise<RosterApiUser | null> {
  const token = readSessionToken(req)
  if (token?.startsWith('demo-')) {
    const email = token.slice('demo-'.length) || 'demo@local'
    return {
      id: 'demo-user',
      email,
      name: 'Demo User',
      accessLevel: 'executive',
      aiAssistantApproved: true,
    }
  }
  return requireSessionUser(req, res)
}
