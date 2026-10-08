import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import { listAuditLog } from "@capacity-api/auditLog";
import { canReadAuditLog } from "@capacity-api/documentAccess";
import {
  getCapacityUserFromSession,
  readCapacitySessionToken,
  toCapacitySessionUser,
} from "@/lib/capacity-api/session";

/**
 * GET /api/capacity/audit?limit=&actorUserId=&targetUserId=&action=&since=&until=
 *
 * Admin only, and read-only: there is no POST. Entries are written server-side by the
 * action being recorded, so nothing here can be fabricated by a browser.
 */
export async function GET(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json(
      { error: "Database is not configured.", code: "db_not_configured" },
      { status: 503 },
    );
  }

  const token = readCapacitySessionToken(request);
  const found = token ? await getCapacityUserFromSession(token) : null;
  if (!found) {
    return NextResponse.json(
      { error: "Authentication required.", code: "unauthorized" },
      { status: 401 },
    );
  }

  const user = toCapacitySessionUser(found);
  if (!canReadAuditLog(user.accessLevel)) {
    return NextResponse.json(
      { error: "Admin access required.", code: "forbidden" },
      { status: 403 },
    );
  }

  const params = request.nextUrl.searchParams;
  const optional = (name: string) => params.get(name) ?? undefined;

  try {
    const entries = await listAuditLog({
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      actorUserId: optional("actorUserId"),
      targetUserId: optional("targetUserId"),
      action: optional("action"),
      since: optional("since"),
      until: optional("until"),
    });
    return NextResponse.json({ entries });
  } catch (error) {
    console.error("Audit lookup failed:", error);
    return NextResponse.json(
      { error: "Audit lookup failed.", code: "audit_error" },
      { status: 500 },
    );
  }
}
