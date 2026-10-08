import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  deleteManagedUserById,
  isAdminAccessLevel,
  setManagedUserActiveState,
  updateManagedUser,
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

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured.", code: "db_not_configured" }, { status: 503 });
  }

  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const actor = auth.user;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "User id is required.", code: "missing_id" }, { status: 400 });
  }

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
    if (typeof body.active === "boolean" && body.email == null && body.name == null) {
      if (body.active === false && actor.id === id) {
        return NextResponse.json(
          { error: "You cannot deactivate your own account.", code: "self_deactivate" },
          { status: 400 },
        );
      }
      const user = await setManagedUserActiveState(id, body.active);
      return NextResponse.json({ user });
    }

    const user = await updateManagedUser(id, {
      email: body.email ?? "",
      name: body.name ?? "",
      password: body.password,
      accessLevel: body.accessLevel ?? "",
      active: typeof body.active === "boolean" ? body.active : undefined,
      allowedClients: Array.isArray(body.allowedClients) ? body.allowedClients : undefined,
    });
    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof UserAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Update user failed:", error);
    return NextResponse.json({ error: "User management failed.", code: "users_error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return PUT(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured.", code: "db_not_configured" }, { status: 503 });
  }

  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;
  const actor = auth.user;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "User id is required.", code: "missing_id" }, { status: 400 });
  }
  if (actor.id === id) {
    return NextResponse.json({ error: "You cannot delete your own account.", code: "self_delete" }, { status: 400 });
  }

  try {
    await deleteManagedUserById(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Delete user failed:", error);
    return NextResponse.json({ error: "User management failed.", code: "users_error" }, { status: 500 });
  }
}
