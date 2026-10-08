import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  DocumentStoreError,
  backfillDocuments,
  canReadAllDocuments,
  deleteDocumentAsActor,
  listAllDocuments,
  listOwnDocuments,
  listUserDocuments,
  saveDocumentAsActor,
} from "@capacity-api/documentStore";
import { clientIpFromHeaders, type AuditActor } from "@capacity-api/auditLog";
import {
  getCapacityUserFromSession,
  readCapacitySessionToken,
  toCapacitySessionUser,
} from "@/lib/capacity-api/session";

type SessionUser = { id: string; email: string; name: string; accessLevel: string };

function toActor(user: SessionUser): AuditActor & { id: string } {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    accessLevel: user.accessLevel,
  };
}

function requestIp(request: NextRequest): string {
  return clientIpFromHeaders((name) => request.headers.get(name));
}

function dbNotConfigured() {
  return NextResponse.json(
    { error: "Database is not configured.", code: "db_not_configured" },
    { status: 503 },
  );
}

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
  if (error instanceof DocumentStoreError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`${fallback}:`, error);
  return NextResponse.json({ error: fallback, code: "documents_error" }, { status: 500 });
}

/**
 * GET /api/capacity/documents          -> the caller's own planning documents
 * GET /api/capacity/documents?scope=all&keys=a,b -> every planner's copy, manager and above only
 * GET /api/capacity/documents?scope=user&userId=x -> one planner's full set, manager and above only
 */
export async function GET(request: NextRequest) {
  if (!mariadbReady()) return dbNotConfigured();

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  const scope = request.nextUrl.searchParams.get("scope");

  try {
    if (scope === "all") {
      if (!canReadAllDocuments(auth.user.accessLevel)) {
        return NextResponse.json(
          { error: "Manager access required.", code: "forbidden" },
          { status: 403 },
        );
      }
      const keys = (request.nextUrl.searchParams.get("keys") ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
      return NextResponse.json({ documents: await listAllDocuments(keys) });
    }

    // One planner's full set, for a manager about to open or edit their plans.
    if (scope === "user") {
      if (!canReadAllDocuments(auth.user.accessLevel)) {
        return NextResponse.json(
          { error: "Manager access required.", code: "forbidden" },
          { status: 403 },
        );
      }
      const userId = request.nextUrl.searchParams.get("userId");
      if (!userId) {
        return NextResponse.json(
          { error: "A userId is required.", code: "missing_user" },
          { status: 400 },
        );
      }
      return NextResponse.json({ documents: await listUserDocuments(userId) });
    }

    return NextResponse.json({ documents: await listOwnDocuments(auth.user.id) });
  } catch (error) {
    return handleError(error, "Document lookup failed.");
  }
}

/**
 * PUT /api/capacity/documents
 *   { key, payload, revision? }        -> save one document
 *   { key, ..., targetUserId }         -> save on a planner's behalf, manager and above
 *   { backfill: [{ key, payload }] }   -> one-time handover from the old workspace blob
 *
 * Ownership never moves: a manager editing for a planner writes to the planner's row and
 * the audit log records who actually made the change.
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

  try {
    if (Array.isArray(body.backfill)) {
      const entries = (body.backfill as Record<string, unknown>[])
        .filter((entry) => typeof entry?.key === "string")
        .map((entry) => ({ key: entry.key as string, payload: entry.payload }));
      return NextResponse.json({
        documents: await backfillDocuments(auth.user.id, entries, auth.user.accessLevel),
      });
    }

    if (typeof body.key !== "string") {
      return NextResponse.json(
        { error: "A document key is required.", code: "missing_key" },
        { status: 400 },
      );
    }

    const revision = typeof body.revision === "number" ? body.revision : undefined;
    const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId : null;
    const document = await saveDocumentAsActor(
      toActor(auth.user),
      body.key,
      body.payload,
      revision,
      targetUserId,
      requestIp(request),
    );
    return NextResponse.json({ document });
  } catch (error) {
    return handleError(error, "Document save failed.");
  }
}

/**
 * DELETE /api/capacity/documents?key=...&targetUserId=...
 * Removes the caller's copy, or a planner's copy when a manager supplies targetUserId.
 */
export async function DELETE(request: NextRequest) {
  if (!mariadbReady()) return dbNotConfigured();

  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json(
      { error: "A document key is required.", code: "missing_key" },
      { status: 400 },
    );
  }

  try {
    await deleteDocumentAsActor(
      toActor(auth.user),
      key,
      request.nextUrl.searchParams.get("targetUserId"),
      requestIp(request),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error, "Document delete failed.");
  }
}
