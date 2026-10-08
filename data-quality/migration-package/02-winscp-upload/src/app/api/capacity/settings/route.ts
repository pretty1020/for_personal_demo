import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  SharedSettingsError,
  listSharedSettings,
  saveSharedSetting,
} from "@capacity-api/sharedSettings";
import { clientIpFromHeaders } from "@capacity-api/auditLog";
import {
  getCapacityUserFromSession,
  readCapacitySessionToken,
  toCapacitySessionUser,
} from "@/lib/capacity-api/session";

function dbNotConfigured() {
  return NextResponse.json(
    { error: "Database is not configured.", code: "db_not_configured" },
    { status: 503 },
  );
}

async function requireUser(request: NextRequest) {
  const token = readCapacitySessionToken(request);
  const user = token ? await getCapacityUserFromSession(token) : null;
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
  if (error instanceof SharedSettingsError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`${fallback}:`, error);
  return NextResponse.json({ error: fallback, code: "settings_error" }, { status: 500 });
}

/**
 * GET /api/capacity/settings
 * Readable by anyone signed in: every planner needs the formulas to render their plan.
 */
export async function GET(request: NextRequest) {
  if (!mariadbReady()) return dbNotConfigured();

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ settings: await listSharedSettings() });
  } catch (error) {
    return handleError(error, "Settings lookup failed.");
  }
}

/**
 * PUT /api/capacity/settings  { key, payload, revision? }
 *
 * Admin only — enforced in saveSharedSetting rather than here, so both API trees get the
 * same rule. A formula edit changes every planner's numbers at once, so it is logged.
 */
export async function PUT(request: NextRequest) {
  if (!mariadbReady()) return dbNotConfigured();

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON.", code: "invalid_json" }, { status: 400 });
  }

  if (typeof body.key !== "string") {
    return NextResponse.json(
      { error: "A setting key is required.", code: "missing_key" },
      { status: 400 },
    );
  }

  try {
    const setting = await saveSharedSetting(
      {
        id: auth.user.id,
        email: auth.user.email,
        name: auth.user.name,
        accessLevel: auth.user.accessLevel,
      },
      body.key,
      body.payload,
      typeof body.revision === "number" ? body.revision : undefined,
      clientIpFromHeaders((name) => request.headers.get(name)),
    );
    return NextResponse.json({ setting });
  } catch (error) {
    return handleError(error, "Settings save failed.");
  }
}
