import { createHash, randomBytes } from "node:crypto";
import { execute, queryRows, usersHasAllowedClientsColumn, type DbUser } from "@capacity-api/db";

export const CAPACITY_SESSION_COOKIE = "wfp_session";
const SESSION_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiryDate(): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);
  return expires;
}

/**
 * Secure cookies need HTTPS. Internal WinSCP/PuTTY deploys are often HTTP —
 * forcing Secure there breaks Capacity login. Set COOKIE_SECURE=true behind TLS.
 */
function cookieSecureSuffix(): string {
  const flag = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return "; Secure";
  if (flag === "false" || flag === "0" || flag === "no") return "";
  // Auto: Vercel/HTTPS platforms only — not bare NODE_ENV=production on HTTP.
  if (process.env.VERCEL === "1") return "; Secure";
  return "";
}

export function sessionCookie(token: string, expires: Date): string {
  const maxAge = Math.floor((expires.getTime() - Date.now()) / 1000);
  return `${CAPACITY_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cookieSecureSuffix()}`;
}

export function clearSessionCookie(): string {
  return `${CAPACITY_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureSuffix()}`;
}

export async function createCapacitySession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("hex");
  const expires = sessionExpiryDate();
  await execute(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`, [
    hashToken(token),
    userId,
    expires,
  ]);
  return { token, expires };
}

export async function deleteCapacitySession(token: string): Promise<void> {
  await execute(`DELETE FROM sessions WHERE token = ?`, [hashToken(token)]);
}

export async function getCapacityUserFromSession(token: string): Promise<DbUser | null> {
  const includeClients = await usersHasAllowedClientsColumn();
  const rows = await queryRows<DbUser>(
    includeClients
      ? `SELECT u.id, u.email, u.name, u.access_level, u.allowed_clients
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ?
           AND s.expires_at > NOW(3)
           AND COALESCE(u.is_active, 1) = 1
         LIMIT 1`
      : `SELECT u.id, u.email, u.name, u.access_level
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ?
           AND s.expires_at > NOW(3)
           AND COALESCE(u.is_active, 1) = 1
         LIMIT 1`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

function parseAllowedClients(raw: unknown): string[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toCapacitySessionUser(user: DbUser) {
  const accessLevel = user.access_level;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    accessLevel,
    allowedClients: accessLevel === "manager" ? parseAllowedClients(user.allowed_clients) : [],
  };
}

export function readCapacitySessionToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim() || null;
  }
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CAPACITY_SESSION_COOKIE) {
      return rest.join("=") || null;
    }
  }
  return null;
}
