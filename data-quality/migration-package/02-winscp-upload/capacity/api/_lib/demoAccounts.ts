export const DEMO_ACCOUNTS = [
  {
    email: 'test@movate.com',
    password: 'movate',
    name: 'Test User',
    accessLevel: 'admin' as const,
  },
  {
    email: 'ben@movate.com',
    password: 'movate',
    name: 'Ben',
    accessLevel: 'director' as const,
  },
  {
    email: 'marian@movate.com',
    password: 'movate',
    name: 'Marian',
    accessLevel: 'cap_planner' as const,
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
    accessLevel: account.accessLevel,
  }
}
