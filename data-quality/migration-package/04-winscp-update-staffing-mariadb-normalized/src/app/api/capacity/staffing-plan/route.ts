import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  StaffingPlanStoreError,
  assertCanListAllStaffingPlans,
  deleteScenarioStaffingPlan,
  listAllStaffingPlanWeeks,
  listStaffingPlanWeeks,
  replaceScenarioStaffingPlanWeeks,
  upsertStaffingPlanWeeks,
  type StaffingPlanShrinkageInput,
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

function parseNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseShrinkage(value: unknown): StaffingPlanShrinkageInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      categoryId: String(row.categoryId ?? row.id ?? ""),
      categoryName: typeof row.categoryName === "string" ? row.categoryName : String(row.name ?? ""),
      categoryGroup:
        typeof row.categoryGroup === "string"
          ? row.categoryGroup
          : typeof row.group === "string"
            ? row.group
            : "in_office",
      plannedPct: parseNullableNumber(row.plannedPct),
      actualPct: parseNullableNumber(row.actualPct),
    };
  });
}

function parseWeekInput(row: Record<string, unknown>): StaffingPlanUpsertInput {
  // Prefer required_production_fte naming; accept legacy requiredHc for one release.
  const requiredProductionFte = parseNullableNumber(
    row.requiredProductionFte ?? row.required_production_fte ?? row.requiredHc ?? row.required_hc,
  );
  const productionFte = parseNullableNumber(
    row.productionFte ?? row.production_fte ?? row.productionHc ?? row.production_hc,
  );
  return {
    scenarioId: String(row.scenarioId ?? ""),
    weekStart: String(row.weekStart ?? ""),
    requiredProductionFte,
    productionFte,
    shrinkage: parseShrinkage(row.shrinkage),
  };
}

/**
 * GET /api/capacity/staffing-plan
 * GET /api/capacity/staffing-plan?scope=all          (manager+)
 * GET /api/capacity/staffing-plan?userId=…          (manager+ reading another planner)
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

  const scope = request.nextUrl.searchParams.get("scope")?.trim().toLowerCase() || "";
  if (scope === "all") {
    try {
      assertCanListAllStaffingPlans(auth.user.accessLevel);
      const weeks = await listAllStaffingPlanWeeks();
      return NextResponse.json({ weeks });
    } catch (error) {
      return handleError(error, "Staffing plan lookup failed.");
    }
  }

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
 * Body: {
 *   weeks: [{ scenarioId, weekStart, requiredProductionFte, productionFte, shrinkage[] }],
 *   ownerUserId?,
 *   replaceScenarioId?
 * }
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
  const weeks: StaffingPlanUpsertInput[] = weeksRaw.map((item) =>
    parseWeekInput((item ?? {}) as Record<string, unknown>),
  );

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
