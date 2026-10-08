import { NextResponse, type NextRequest } from "next/server";
import { requireDqAdmin } from "@/lib/api-guard";
import { createDqUser, listDqUsersDetailed, type DqRole } from "@/lib/dq-auth";

export async function GET(request: NextRequest) {
  const auth = await requireDqAdmin(request);
  if ("error" in auth) return auth.error;

  try {
    const users = await listDqUsersDetailed();
    return NextResponse.json({ users });
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
}

export async function POST(request: NextRequest) {
  const auth = await requireDqAdmin(request);
  if ("error" in auth) return auth.error;

  let body: { email?: string; password?: string; name?: string; role?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  const role: DqRole = body.role === "admin" ? "admin" : "user";

  if (!email || !password || !name) {
    return NextResponse.json(
      { error: "Name, email, and password are required." },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  try {
    const user = await createDqUser({ email, password, name, role });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Duplicate|ER_DUP_ENTRY/i.test(message)) {
      return NextResponse.json({ error: "That email is already registered." }, { status: 409 });
    }
    throw error;
  }
}
