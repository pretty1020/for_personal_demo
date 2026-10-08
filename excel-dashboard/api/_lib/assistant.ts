import type { SessionUser } from './session.js'
import { getDb, queryRows } from './db.js'

export type { ChatMessage } from './assistantCore.js'
export { ASSISTANT_SYSTEM_PROMPT, buildAssistantPersonaBlock, trimContext, callOpenAiChat } from './assistantCore.js'

export async function getAiAssistantApproved(userId: string): Promise<boolean> {
  const sql = getDb()
  const rows = await queryRows<{ ai_assistant_approved: boolean }>(sql`
    SELECT ai_assistant_approved FROM users WHERE id = ${userId} LIMIT 1
  `)
  return rows[0]?.ai_assistant_approved ?? false
}

export function canUseAiAssistant(user: SessionUser, adminApproved: boolean): boolean {
  return user.accessLevel === 'executive' || adminApproved
}
