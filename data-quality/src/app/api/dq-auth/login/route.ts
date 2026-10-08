import { NextResponse, type NextRequest } from "next/server";
import {
  createDqSession,
  dqAuthEnabled,
  dqSessionCookie,
  findDqUserByEmail,
  toDqSessionUser,
  verifyDqPassword,
} from "@/lib/dq-auth";
import { mariadbReady } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    if (!mariadbReady()) {
      return NextResponse.json(
        {
          error: "MariaDB is not configured. Set STANDALONE=false and DB_* in .env.local.",
          code: "db_not_configured",
        },
        { status: 503 },
      );
    }
    if (!dqAuthEnabled()) {
      return NextResponse.json(
        { error: "Data Quality auth is disabled.", code: "auth_disabled" },
        { status: 503 },
      );
    }

    let body: { email?: string; password?: string };
    try {
      body = (await request.json()) as { email?: string; password?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON.", code: "invalid_json" }, { status: 400 });
    }

    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password?.trim() ?? "";
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required.", code: "missing_credentials" },
        { status: 400 },
      );
    }

    let user;
    try {
      user = await findDqUserByEmail(email);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/dq_users|doesn't exist/i.test(message)) {
        return NextResponse.json(
          {
            error:
              "Data Quality login tables are missing. Run migration-package/01-sqlyog/017_dq_auth.sql in SQLyog.",
            code: "dq_auth_schema_missing",
          },
          { status: 503 },
        );
      }
      throw error;
    }

    if (!user || !user.password_hash || !(await verifyDqPassword(password, user.password_hash))) {
      return NextResponse.json(
        { error: "Invalid email or password.", code: "invalid_credentials" },
        { status: 401 },
      );
    }
    if (user.is_active === 0 || user.is_active === false) {
      return NextResponse.json(
        { error: "This account is inactive. Contact a Data Quality admin.", code: "inactive" },
        { status: 403 },
      );
    }

    const { token, expires } = await createDqSession(user.id);
    const response = NextResponse.json({
      user: toDqSessionUser(user),
      token,
    });
    response.headers.set("Set-Cookie", dqSessionCookie(token, expires));
    return response;
  } catch (error) {
    console.error("DQ login failed:", error);
    return NextResponse.json(
      { error: "Login failed unexpectedly. Check database connectivity.", code: "login_error" },
      { status: 500 },
    );
  }
}
