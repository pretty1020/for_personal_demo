export type DemoAppRole = 'admin' | 'cap_planner' | 'manager' | 'director' | 'vp'

export const DEMO_ACCOUNTS = [
  {
    email: 'admin@demo.local',
    password: 'demo',
    name: 'Admin',
    appRole: 'admin' as const,
    accessLevel: 'executive' as const,
    aiAssistantApproved: true,
  },
  {
    email: 'demo@demo.local',
    password: 'demo',
    name: 'Demo User',
    appRole: 'vp' as const,
    accessLevel: 'executive' as const,
    aiAssistantApproved: true,
  },
] as const

export type DemoAccount = (typeof DEMO_ACCOUNTS)[number]

export function matchDemoAccount(email: string, password: string): DemoAccount | null {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedPassword = password.trim()
  return (
    DEMO_ACCOUNTS.find(
      (account) => account.email === normalizedEmail && account.password === normalizedPassword,
    ) ?? null
  )
}

export function demoUserResponse(account: DemoAccount) {
  return {
    id: `demo-${account.email}`,
    email: account.email,
    name: account.name,
    /** Fine-grained app role — client normalizes legacy values. */
    accessLevel: account.appRole,
    aiAssistantApproved: account.aiAssistantApproved,
  }
}
