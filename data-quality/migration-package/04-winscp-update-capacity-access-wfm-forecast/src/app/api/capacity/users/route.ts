import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  createManagedUser,
  isAdminAccessLevel,
  listManagedUsers,
  UserAdminError,
} from "@capacity-api/userAdmin";
import {
  getCapacityUserFromSession,
  readCapacitySessionToken,
  toCapacitySessionUser,
} from "@/lib/capacity-api/session";

async function requireAdmin(request: NextRequest) {
  const token = readCapacitySessionToken(request);
  if (!token) return { error: NextResponse.json({ error: "Authentication required.", code: "unauthorized" }, { status: 401 }) };
  const user = await getCapacityUserFromSession(token);
  if (!user) return { error: NextResponse.json({ error: "Authentication required.", code: "unauthorized" }, { status: 401 }) };
  const sessionUser = toCapacitySessionUser(user);
  if (!isAdminAccessLevel(sessionUser.accessLevel)) {
    return { error: NextResponse.json({ error: "Admin access required.", code: "forbidden" }, { status: 403 }) };
  }
  return { user: sessionUser };
}

export async function GET(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured.", code: "db_not_configured" }, { status: 503 });
  }

  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  try {
    const users = await listManagedUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.error("List users failed:", error);
    return NextResponse.json({ error: "User management failed.", code: "users_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured.", code: "db_not_configured" }, { status: 503 });
  }

  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  let body: {
    email?: string;
    name?: string;
    password?: string;
    accessLevel?: string;
    active?: boolean;
    allowedClients?: string[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON.", code: "invalid_json" }, { status: 400 });
  }

  try {
    const user = await createManagedUser({
      email: body.email ?? "",
      name: body.name ?? "",
      password: body.password,
      accessLevel: body.accessLevel ?? "",
      active: body.active !== false,
      allowedClients: Array.isArray(body.allowedClients) ? body.allowedClients : undefined,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof UserAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Create user failed:", error);
    return NextResponse.json({ error: "User management failed.", code: "users_error" }, { status: 500 });
  }
}
