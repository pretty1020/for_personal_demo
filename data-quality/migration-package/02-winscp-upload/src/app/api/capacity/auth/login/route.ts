import { NextResponse, type NextRequest } from "next/server";
import { findUserByEmail, verifyPassword } from "@capacity-api/auth";
import { mariadbReady } from "@capacity-api/db";
import { createCapacitySession, sessionCookie, toCapacitySessionUser } from "@/lib/capacity-api/session";

export async function POST(request: NextRequest) {
  try {
    if (!mariadbReady()) {
      return NextResponse.json(
        {
          error: "Database is not configured. Set STANDALONE=false and DB_* in .env.local.",
          code: "db_not_configured",
        },
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

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return NextResponse.json(
        { error: "Invalid email or password.", code: "invalid_credentials" },
        { status: 401 },
      );
    }
    if (user.is_active === 0 || user.is_active === false) {
      return NextResponse.json(
        { error: "This account is inactive. Contact an admin.", code: "inactive" },
        { status: 403 },
      );
    }

    const { token, expires } = await createCapacitySession(user.id);
    const response = NextResponse.json({
      user: toCapacitySessionUser(user),
      token,
      mode: "database",
    });
    response.headers.set("Set-Cookie", sessionCookie(token, expires));
    return response;
  } catch (error) {
    console.error("Capacity login failed:", error);
    return NextResponse.json(
      { error: "Login failed unexpectedly. Check database connectivity.", code: "login_error" },
      { status: 500 },
    );
  }
}
