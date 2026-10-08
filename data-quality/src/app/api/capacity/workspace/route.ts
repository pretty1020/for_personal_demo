import { NextResponse, type NextRequest } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { mariadbReady, queryRows } from "@capacity-api/db";
import {
  isEmptyWorkspace,
  normalizeWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "@capacity-api/workspace";
import { getCapacityUserFromSession, readCapacitySessionToken } from "@/lib/capacity-api/session";

async function requireUser(request: NextRequest) {
  const token = readCapacitySessionToken(request);
  if (!token) return null;
  return getCapacityUserFromSession(token);
}

type WorkspaceRow = RowDataPacket & { state: WorkspaceSnapshot | string; updated_at: string };

export async function GET(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const user = await requireUser(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const rows = await queryRows<WorkspaceRow>(
    `SELECT state, updated_at FROM workspace_state WHERE user_id = ? LIMIT 1`,
    [user.id],
  );
  const row = rows[0];
  const rawState = row?.state;
  const parsedState =
    typeof rawState === "string" ? (JSON.parse(rawState) as WorkspaceSnapshot) : (rawState ?? {});
  const snapshot = normalizeWorkspaceSnapshot(parsedState);

  return NextResponse.json({
    snapshot,
    updatedAt: row?.updated_at ?? null,
    empty: isEmptyWorkspace(snapshot),
  });
}

/**
 * Retired. Planning data is written to capacity_documents, one row per document.
 *
 * The table is kept read-only rather than dropped so a user who last saved before the
 * move can still be migrated by GET above. Refusing the write here — instead of just
 * removing the call from the app — means a browser still running a cached copy of the
 * old bundle cannot quietly keep writing to the old blob and diverge from the database.
 */
export async function PUT() {
  return NextResponse.json(
    {
      error:
        "The workspace snapshot is read-only. Reload the page to pick up the current version, which saves to the database.",
      code: "workspace_readonly",
    },
    { status: 410 },
  );
}
