import mysql from "mysql2/promise";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { getMariaDbConfig } from "@/lib/mariadb/config";
import { logError } from "@/lib/logger";

let pool: Pool | null = null;

export function getMariaDbPool(): Pool {
  if (pool) return pool;
  const cfg = getMariaDbConfig();
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionLimit: cfg.connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    timezone: "Z",
    dateStrings: true,
    charset: "utf8mb4",
  });

  utcSessions.clear();
  return pool;
}

/**
 * Physical connections whose session is already pinned to UTC, tracked by thread id.
 *
 * The driver's `timezone: "Z"` option only governs JS Date conversion; it does not
 * touch the session, so server-side CURRENT_TIMESTAMP(3) defaults (audit_logs,
 * notifications, file_errors, checklist_results, and checklist_results.updated_at
 * via ON UPDATE) would be written in the DB host's local time while the app writes
 * UTC — and fromSqlDateTime() then labels both as UTC. '+00:00' is used instead of
 * 'UTC' because the named zone needs the optional mysql time zone tables loaded.
 */
const utcSessions = new Set<number>();

async function ensureUtcSession(conn: PoolConnection): Promise<void> {
  const id = conn.threadId;
  if (typeof id === "number" && utcSessions.has(id)) return;
  await conn.query("SET time_zone = '+00:00'");
  if (typeof id === "number") utcSessions.add(id);
}

export async function withMariaDb<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const p = getMariaDbPool();
  const conn = await p.getConnection();
  try {
    await ensureUtcSession(conn);
    return await fn(conn);
  } catch (e) {
    logError("mariadb.query", e);
    throw e;
  } finally {
    conn.release();
  }
}

export async function withMariaDbTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  return withMariaDb(async (conn) => {
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  });
}

export async function pingMariaDb(): Promise<boolean> {
  try {
    await withMariaDb(async (conn) => {
      await conn.query("SELECT 1");
    });
    return true;
  } catch {
    return false;
  }
}

export type MariaDbRow = RowDataPacket;
