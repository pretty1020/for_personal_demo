import type { NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  getCapacityUserFromSession,
  readCapacitySessionToken,
  toCapacitySessionUser,
} from "@/lib/capacity-api/session";

export type RosterApiUser = ReturnType<typeof toCapacitySessionUser>;

/**
 * Roster endpoints require a real Capacity DB session.
 * Demo tokens are rejected (no offline demo auth).
 */
export async function getRosterApiUser(request: NextRequest): Promise<RosterApiUser | null> {
  const token = readCapacitySessionToken(request);
  if (!token) return null;
  if (token.startsWith("demo-")) return null;
  if (!mariadbReady()) return null;

  const user = await getCapacityUserFromSession(token);
  return user ? toCapacitySessionUser(user) : null;
}
