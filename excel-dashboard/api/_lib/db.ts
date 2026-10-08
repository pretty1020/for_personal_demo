import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

let sql: NeonQueryFunction<false, false> | null = null

export function getDb() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not configured.')
  }
  if (!sql) {
    sql = neon(url)
  }
  return sql
}

/** Neon no longer accepts sql<T[]>`...` — cast query results to typed rows. */
export async function queryRows<T extends Record<string, unknown>>(
  result: Promise<unknown>,
): Promise<T[]> {
  return (await result) as T[]
}

export type DbUser = {
  id: string
  email: string
  name: string
  access_level: 'executive' | 'manager'
  ai_assistant_approved: boolean
}

export type DbUserRow = DbUser & {
  password_hash: string
}