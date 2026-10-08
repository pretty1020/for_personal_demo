import { NextResponse } from "next/server";
import { getDataBackend, mariadbReady } from "@/lib/db";
import {
  dqAuthEnabled,
  getDqUserFromRequest,
  type DqUser,
} from "@/lib/dq-auth";

export function requireBackend() {
  // Order matters: ask for the backend first. usesJson() is itself derived from
  // getDataBackend(), so returning early on it would hide a misconfigured MariaDB.
  const backend = getDataBackend();
  if (backend === "mariadb" && !mariadbReady()) {
    return NextResponse.json(
      {
        error:
          "MariaDB is selected but not configured. Set DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD in .env.local, then restart.",
      },
      { status: 503 },
    );
  }
  return null;
}

/**
 * Require a Data Quality session when DQ auth is enabled (MariaDB).
 * Capacity APIs must not call this — they use Capacity sessions.
 */
export async function requireDqAuth(
  request: Request,
): Promise<{ error: NextResponse } | { user: DqUser | null }> {
  const blocked = requireBackend();
  if (blocked) return { error: blocked };

  if (!dqAuthEnabled()) {
    return { user: null };
  }

  try {
    const user = await getDqUserFromRequest(request);
    if (!user) {
      return {
        error: NextResponse.json(
          { error: "Sign in required for Data Quality.", code: "unauthorized" },
          { status: 401 },
        ),
      };
    }
    return { user };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/dq_users|dq_sessions|doesn't exist/i.test(message)) {
      return {
        error: NextResponse.json(
          {
            error:
              "Data Quality login tables are missing. Run migration-package/01-sqlyog/017_dq_auth.sql in SQLyog.",
            code: "dq_auth_schema_missing",
          },
          { status: 503 },
        ),
      };
    }
    throw error;
  }
}

export async function requireDqAdmin(
  request: Request,
): Promise<{ error: NextResponse } | { user: DqUser }> {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth;
  if (!auth.user) {
    // Auth disabled (JSON mode) — treat as open for local demos.
    return {
      user: {
        id: "local",
        email: "local@dev",
        name: "Local",
        role: "admin",
        is_active: 1,
      },
    };
  }
  if (auth.user.role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Admin access required.", code: "forbidden" },
        { status: 403 },
      ),
    };
  }
  return { user: auth.user };
}
