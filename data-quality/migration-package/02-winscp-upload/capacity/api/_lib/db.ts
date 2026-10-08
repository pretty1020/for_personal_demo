import mysql from 'mysql2/promise'
import type { ExecuteValues, Pool, QueryValues, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

export type MariaDbConfig = {
  host: string
  port: number
  database: string
  user: string
  password: string
  connectionLimit: number
}

let pool: Pool | null = null

export function mariadbReady(): boolean {
  return Boolean(
    process.env.DB_HOST?.trim() &&
      process.env.DB_NAME?.trim() &&
      process.env.DB_USER?.trim() &&
      process.env.DB_PASSWORD !== undefined,
  )
}

export function getMariaDbConfig(): MariaDbConfig {
  const host = process.env.DB_HOST?.trim()
  const database = process.env.DB_NAME?.trim()
  const user = process.env.DB_USER?.trim()
  const password = process.env.DB_PASSWORD ?? ''

  if (!host || !database || !user) {
    throw new Error('MariaDB configuration incomplete. Set DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.')
  }

  const port = Number(process.env.DB_PORT || '3306')
  const connectionLimit = Number(process.env.DB_POOL_SIZE || '10')

  return {
    host,
    port: Number.isFinite(port) ? port : 3306,
    database,
    user,
    password,
    connectionLimit: Number.isFinite(connectionLimit) ? connectionLimit : 10,
  }
}

export function getPool(): Pool {
  if (!pool) {
    const config = getMariaDbConfig()
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectionLimit: config.connectionLimit,
      waitForConnections: true,
      timezone: 'Z',
    })
  }
  return pool
}

export async function queryRows<T extends RowDataPacket>(
  sql: string,
  params: QueryValues = [],
): Promise<T[]> {
  const [rows] = await getPool().query<T[]>(sql, params)
  return rows
}

export async function execute(sql: string, params: ExecuteValues = []): Promise<ResultSetHeader> {
  const [result] = await getPool().execute(sql, params)
  return result as ResultSetHeader
}

export async function pingMariaDb(): Promise<boolean> {
  if (!mariadbReady()) return false
  try {
    await queryRows<RowDataPacket>('SELECT 1 AS ok')
    return true
  } catch {
    return false
  }
}

export type DbUser = RowDataPacket & {
  id: string
  email: string
  name: string
  access_level: string
  is_active?: number | boolean | null
}

export type DbUserRow = DbUser & {
  password_hash: string
}
