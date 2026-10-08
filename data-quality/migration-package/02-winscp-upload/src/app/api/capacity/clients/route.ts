import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  ClientAdminError,
  canWriteClients,
  createManagedClient,
  listManagedClients,
  seedManagedClients,
  type ClientWriteInput,
} from "@capacity-api/clientAdmin";
import {
  getCapacityUserFromSession,
  readCapacitySessionToken,
  toCapacitySessionUser,
} from "@/lib/capacity-api/session";

async function requireUser(request: NextRequest) {
  const token = readCapacitySessionToken(request);
  if (!token) return { error: NextResponse.json({ error: "Authentication required.", code: "unauthorized" }, { status: 401 }) };
  const user = await getCapacityUserFromSession(token);
  if (!user) return { error: NextResponse.json({ error: "Authentication required.", code: "unauthorized" }, { status: 401 }) };
  return { user: toCapacitySessionUser(user) };
}

function toWriteInput(raw: Record<string, unknown>): ClientWriteInput {
  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    name: String(raw.name ?? ""),
    weekStart: typeof raw.weekStart === "string" ? raw.weekStart : undefined,
    capacityPlanStartWeek:
      typeof raw.capacityPlanStartWeek === "string" ? raw.capacityPlanStartWeek : undefined,
    planningWeeks: typeof raw.planningWeeks === "number" ? raw.planningWeeks : undefined,
    buildMethod: typeof raw.buildMethod === "string" ? raw.buildMethod : undefined,
    defaultPaidHours:
      typeof raw.defaultPaidHours === "number" ? raw.defaultPaidHours : undefined,
    defaultShrinkagePct:
      typeof raw.defaultShrinkagePct === "number" ? raw.defaultShrinkagePct : undefined,
  };
}

export async function GET(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured.", code: "db_not_configured" }, { status: 503 });
  }

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  try {
    const clients = await listManagedClients();
    return NextResponse.json({ clients });
  } catch (error) {
    console.error("List clients failed:", error);
    return NextResponse.json({ error: "Client lookup failed.", code: "clients_error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured.", code: "db_not_configured" }, { status: 503 });
  }

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  if (!canWriteClients(auth.user.accessLevel)) {
    return NextResponse.json({ error: "Planner access required.", code: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON.", code: "invalid_json" }, { status: 400 });
  }

  try {
    // Migration path from the old localStorage/workspace-blob storage.
    if (Array.isArray(body.seed)) {
      const clients = await seedManagedClients(
        (body.seed as Record<string, unknown>[]).map(toWriteInput),
        auth.user.id,
      );
      return NextResponse.json({ clients });
    }

    const client = await createManagedClient(toWriteInput(body), auth.user.id);
    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    if (error instanceof ClientAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Create client failed:", error);
    return NextResponse.json({ error: "Client save failed.", code: "clients_error" }, { status: 500 });
  }
}
