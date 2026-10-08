import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserFromSession, readSessionToken } from './session.js'
import { getAiAssistantApproved, canUseAiAssistant } from './assistant.js'
import { json } from './http.js'

export type AssistantAuth = {
  accessLevel?: 'executive' | 'manager'
  aiAssistantApproved?: boolean
}

function isClientAuthorized(auth?: AssistantAuth): boolean {
  return auth?.accessLevel === 'executive' || auth?.aiAssistantApproved === true
}

export async function authorizeAssistant(
  req: VercelRequest,
  res: VercelResponse,
  auth?: AssistantAuth,
): Promise<boolean> {
  if (process.env.DATABASE_URL) {
    const token = readSessionToken(req)
    if (token) {
      try {
        const user = await getUserFromSession(token)
        if (user) {
          let approved = false
          try {
            approved = await getAiAssistantApproved(user.id)
          } catch (error) {
            console.error('Assistant access lookup failed:', error)
            json(res, 500, { error: 'Could not verify assistant access.' })
            return false
          }
          if (!canUseAiAssistant(user, approved)) {
            json(res, 403, { error: 'AI Assistant is available to executives or admin-approved users only.' })
            return false
          }
          return true
        }
      } catch (error) {
        console.error('Session lookup failed:', error)
        json(res, 500, { error: 'Authentication service unavailable.' })
        return false
      }
    }

    if (isClientAuthorized(auth)) return true
    json(res, 401, { error: 'Authentication required.' })
    return false
  }

  if (isClientAuthorized(auth)) return true
  json(res, 403, { error: 'AI Assistant is available to executives or admin-approved users only.' })
  return false
}
