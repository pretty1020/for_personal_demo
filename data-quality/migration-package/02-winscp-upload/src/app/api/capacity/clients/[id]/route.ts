import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  ClientAdminError,
  canWriteClients,
  deleteManagedClientById,
  updateManagedClient,
  type ClientWriteInput,
} from "@capacity-api/clientAdmin";
import {
  getCapacityUserFromSession,
  readCapacitySessionToken,
  toCapacitySessionUser,
} from "@/lib/capacity-api/session";

async function requireWriter(request: NextRequest) {
  const token = readCapacitySessionToken(request);
  if (!token) return { error: NextResponse.json({ error: "Authentication required.", code: "unauthorized" }, { status: 401 }) };
  const user = await getCapacityUserFromSession(token);
  if (!user) return { error: NextResponse.json({ error: "Authentication required.", code: "unauthorized" }, { status: 401 }) };
  const sessionUser = toCapacitySessionUser(user);
  if (!canWriteClients(sessionUser.accessLevel)) {
    return { error: NextResponse.json({ error: "Planner access required.", code: "forbidden" }, { status: 403 }) };
  }
  return { user: sessionUser };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: RouteContext) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured.", code: "db_not_configured" }, { status: 503 });
  }

  const auth = await requireWriter(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Client id is required.", code: "missing_id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON.", code: "invalid_json" }, { status: 400 });
  }

  const input: ClientWriteInput = {
    name: String(body.name ?? ""),
    weekStart: typeof body.weekStart === "string" ? body.weekStart : undefined,
    capacityPlanStartWeek:
      typeof body.capacityPlanStartWeek === "string" ? body.capacityPlanStartWeek : undefined,
    planningWeeks: typeof body.planningWeeks === "number" ? body.planningWeeks : undefined,
    buildMethod: typeof body.buildMethod === "string" ? body.buildMethod : undefined,
    defaultPaidHours:
      typeof body.defaultPaidHours === "number" ? body.defaultPaidHours : undefined,
    defaultShrinkagePct:
      typeof body.defaultShrinkagePct === "number" ? body.defaultShrinkagePct : undefined,
  };

  try {
    const client = await updateManagedClient(id, input);
    return NextResponse.json({ client });
  } catch (error) {
    if (error instanceof ClientAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Update client failed:", error);
    return NextResponse.json({ error: "Client save failed.", code: "clients_error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return PUT(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured.", code: "db_not_configured" }, { status: 503 });
  }

  const auth = await requireWriter(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Client id is required.", code: "missing_id" }, { status: 400 });
  }

  try {
    await deleteManagedClientById(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ClientAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Delete client failed:", error);
    return NextResponse.json({ error: "Client delete failed.", code: "clients_error" }, { status: 500 });
  }
}
