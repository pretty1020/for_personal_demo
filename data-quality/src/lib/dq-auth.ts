import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { withMariaDb } from "@/lib/mariadb/pool";
import { mariadbReady } from "@/lib/mariadb/config";

export const DQ_SESSION_COOKIE = "dq_session";
export type DqRole = "admin" | "user";

export type DqUser = {
  id: string;
  email: string;
  name: string;
  role: DqRole;
  is_active: number | boolean;
  password_hash?: string;
};

export type DqSessionUser = {
  id: string;
  email: string;
  name: string;
  role: DqRole;
};

const SESSION_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookieSecureSuffix(): string {
  const flag = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return "; Secure";
  if (flag === "false" || flag === "0" || flag === "no") return "";
  if (process.env.VERCEL === "1") return "; Secure";
  return "";
}

export function dqAuthEnabled(): boolean {
  // DQ auth uses MariaDB tables only. JSON/standalone demos stay open.
  if (!mariadbReady()) return false;
  const flag = process.env.DQ_AUTH_DISABLED?.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return false;
  return true;
}

export function sessionExpiryDate(): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);
  return expires;
}

export function dqSessionCookie(token: string, expires: Date): string {
  const maxAge = Math.floor((expires.getTime() - Date.now()) / 1000);
  return `${DQ_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cookieSecureSuffix()}`;
}

export function clearDqSessionCookie(): string {
  return `${DQ_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureSuffix()}`;
}

export function readDqSessionToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
  }
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DQ_SESSION_COOKIE) {
      return rest.join("=") || null;
    }
  }
  return null;
}

export function toDqSessionUser(user: Pick<DqUser, "id" | "email" | "name" | "role">): DqSessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === "admin" ? "admin" : "user",
  };
}

export async function verifyDqPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function hashDqPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function findDqUserByEmail(email: string): Promise<DqUser | null> {
  return withMariaDb(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, email, password_hash, name, role, COALESCE(is_active, 1) AS is_active
         FROM dq_users
        WHERE LOWER(email) = LOWER(?)
        LIMIT 1`,
      [email.trim().toLowerCase()],
    );
    return (rows[0] as DqUser | undefined) ?? null;
  });
}

export async function findDqUserById(id: string): Promise<DqUser | null> {
  return withMariaDb(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, email, name, role, COALESCE(is_active, 1) AS is_active
         FROM dq_users
        WHERE id = ?
        LIMIT 1`,
      [id],
    );
    return (rows[0] as DqUser | undefined) ?? null;
  });
}

export async function createDqSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("hex");
  const expires = sessionExpiryDate();
  await withMariaDb(async (conn) => {
    await conn.query(`INSERT INTO dq_sessions (token, user_id, expires_at) VALUES (?, ?, ?)`, [
      hashToken(token),
      userId,
      expires,
    ]);
  });
  return { token, expires };
}

export async function deleteDqSession(token: string): Promise<void> {
  await withMariaDb(async (conn) => {
    await conn.query(`DELETE FROM dq_sessions WHERE token = ?`, [hashToken(token)]);
  });
}

export async function getDqUserFromSession(token: string): Promise<DqUser | null> {
  return withMariaDb(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT u.id, u.email, u.name, u.role, COALESCE(u.is_active, 1) AS is_active
         FROM dq_sessions s
         JOIN dq_users u ON u.id = s.user_id
        WHERE s.token = ?
          AND s.expires_at > NOW(3)
          AND COALESCE(u.is_active, 1) = 1
        LIMIT 1`,
      [hashToken(token)],
    );
    return (rows[0] as DqUser | undefined) ?? null;
  });
}

export async function getDqUserFromRequest(request: Request): Promise<DqUser | null> {
  if (!dqAuthEnabled()) return null;
  const token = readDqSessionToken(request);
  if (!token) return null;
  try {
    return await getDqUserFromSession(token);
  } catch {
    // Tables may not exist until 017 is applied.
    return null;
  }
}

export type DqUserListItem = DqSessionUser & { isActive: boolean };

export async function listDqUsersDetailed(): Promise<DqUserListItem[]> {
  return withMariaDb(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, email, name, role, COALESCE(is_active, 1) AS is_active
         FROM dq_users
        ORDER BY role ASC, name ASC`,
    );
    return (rows as DqUser[]).map((u) => ({
      ...toDqSessionUser(u),
      isActive: !(u.is_active === 0 || u.is_active === false),
    }));
  });
}

export async function createDqUser(input: {
  email: string;
  password: string;
  name: string;
  role: DqRole;
}): Promise<DqUserListItem> {
  const id = randomUUID();
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const role: DqRole = input.role === "admin" ? "admin" : "user";
  const passwordHash = await hashDqPassword(input.password);
  await withMariaDb(async (conn) => {
    await conn.query(
      `INSERT INTO dq_users (id, email, password_hash, name, role, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [id, email, passwordHash, name, role],
    );
  });
  return { id, email, name, role, isActive: true };
}

export async function updateDqUser(
  id: string,
  input: {
    email?: string;
    name?: string;
    role?: DqRole;
    isActive?: boolean;
    password?: string;
  },
): Promise<DqUserListItem | null> {
  const existing = await findDqUserById(id);
  if (!existing) return null;

  const email = (input.email ?? existing.email).trim().toLowerCase();
  const name = (input.name ?? existing.name).trim();
  const role: DqRole = (input.role ?? existing.role) === "admin" ? "admin" : "user";
  const isActive =
    input.isActive === undefined
      ? !(existing.is_active === 0 || existing.is_active === false)
      : Boolean(input.isActive);

  if (input.password && input.password.trim()) {
    const passwordHash = await hashDqPassword(input.password.trim());
    await withMariaDb(async (conn) => {
      await conn.query(
        `UPDATE dq_users
            SET email = ?, name = ?, role = ?, is_active = ?, password_hash = ?
          WHERE id = ?`,
        [email, name, role, isActive ? 1 : 0, passwordHash, id],
      );
    });
  } else {
    await withMariaDb(async (conn) => {
      await conn.query(
        `UPDATE dq_users
            SET email = ?, name = ?, role = ?, is_active = ?
          WHERE id = ?`,
        [email, name, role, isActive ? 1 : 0, id],
      );
    });
  }

  return { id, email, name, role, isActive };
}

export async function deleteDqUser(id: string): Promise<boolean> {
  const result = await withMariaDb(async (conn) => {
    const [res] = await conn.query(`DELETE FROM dq_users WHERE id = ?`, [id]);
    return res as { affectedRows?: number };
  });
  return (result.affectedRows ?? 0) > 0;
}

export async function countDqAdmins(): Promise<number> {
  return withMariaDb(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM dq_users WHERE role = 'admin' AND COALESCE(is_active, 1) = 1`,
    );
    return Number(rows[0]?.c ?? 0);
  });
}
