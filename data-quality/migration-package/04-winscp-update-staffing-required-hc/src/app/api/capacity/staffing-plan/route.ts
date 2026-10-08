import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  StaffingPlanStoreError,
  deleteScenarioStaffingPlan,
  listStaffingPlanWeeks,
  replaceScenarioStaffingPlanWeeks,
  upsertStaffingPlanWeeks,
  type StaffingPlanUpsertInput,
} from "@capacity-api/staffingPlanStore";
import { canReadAllDocuments } from "@capacity-api/documentAccess";
import {
  getCapacityUserFromSession,
  readCapacitySessionToken,
  toCapacitySessionUser,
} from "@/lib/capacity-api/session";

async function requireUser(request: NextRequest) {
  const token = readCapacitySessionToken(request);
  if (!token) {
    return {
      error: NextResponse.json(
        { error: "Authentication required.", code: "unauthorized" },
        { status: 401 },
      ),
    };
  }
  const user = await getCapacityUserFromSession(token);
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Authentication required.", code: "unauthorized" },
        { status: 401 },
      ),
    };
  }
  return { user: toCapacitySessionUser(user) };
}

function handleError(error: unknown, fallback: string) {
  if (error instanceof StaffingPlanStoreError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`${fallback}:`, error);
  return NextResponse.json({ error: fallback, code: "staffing_plan_error" }, { status: 500 });
}

/**
 * GET /api/capacity/staffing-plan
 * GET /api/capacity/staffing-plan?userId=…  (manager+ reading another planner)
 */
export async function GET(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json(
      { error: "Database is not configured.", code: "db_not_configured" },
      { status: 503 },
    );
  }

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  const userId = request.nextUrl.searchParams.get("userId")?.trim() || auth.user.id;
  if (userId !== auth.user.id && !canReadAllDocuments(auth.user.accessLevel)) {
    return NextResponse.json(
      { error: "You cannot read another planner's staffing plan.", code: "forbidden" },
      { status: 403 },
    );
  }

  try {
    const weeks = await listStaffingPlanWeeks(userId);
    return NextResponse.json({ weeks });
  } catch (error) {
    return handleError(error, "Staffing plan lookup failed.");
  }
}

/**
 * PUT /api/capacity/staffing-plan
 * Body: { weeks: [{ scenarioId, weekStart, requiredHc, productionHc }], ownerUserId?, replaceScenarioId? }
 */
export async function PUT(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json(
      { error: "Database is not configured.", code: "db_not_configured" },
      { status: 503 },
    );
  }

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON.", code: "invalid_json" }, { status: 400 });
  }

  const ownerUserId =
    typeof body.ownerUserId === "string" && body.ownerUserId.trim()
      ? body.ownerUserId.trim()
      : undefined;
  const weeksRaw = Array.isArray(body.weeks) ? body.weeks : [];
  const weeks: StaffingPlanUpsertInput[] = weeksRaw.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      scenarioId: String(row.scenarioId ?? ""),
      weekStart: String(row.weekStart ?? ""),
      requiredHc:
        row.requiredHc === undefined
          ? undefined
          : row.requiredHc == null
            ? null
            : Number(row.requiredHc),
      productionHc:
        row.productionHc === undefined
          ? undefined
          : row.productionHc == null
            ? null
            : Number(row.productionHc),
    };
  });

  try {
    const replaceScenarioId =
      typeof body.replaceScenarioId === "string" ? body.replaceScenarioId.trim() : "";
    const saved = replaceScenarioId
      ? await replaceScenarioStaffingPlanWeeks(
          auth.user.id,
          auth.user.accessLevel,
          ownerUserId,
          replaceScenarioId,
          weeks,
        )
      : await upsertStaffingPlanWeeks(auth.user.id, auth.user.accessLevel, ownerUserId, weeks);
    return NextResponse.json({ weeks: saved });
  } catch (error) {
    return handleError(error, "Staffing plan save failed.");
  }
}

/**
 * DELETE /api/capacity/staffing-plan?scenarioId=…
 */
export async function DELETE(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json(
      { error: "Database is not configured.", code: "db_not_configured" },
      { status: 503 },
    );
  }

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  const scenarioId = request.nextUrl.searchParams.get("scenarioId")?.trim() ?? "";
  const ownerUserId = request.nextUrl.searchParams.get("userId")?.trim() || undefined;
  if (!scenarioId) {
    return NextResponse.json(
      { error: "scenarioId is required.", code: "invalid_query" },
      { status: 400 },
    );
  }

  try {
    await deleteScenarioStaffingPlan(
      auth.user.id,
      auth.user.accessLevel,
      ownerUserId,
      scenarioId,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error, "Staffing plan delete failed.");
  }
}
