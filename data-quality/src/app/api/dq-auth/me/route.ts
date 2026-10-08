import { NextResponse, type NextRequest } from "next/server";
import {
  dqAuthEnabled,
  getDqUserFromRequest,
  toDqSessionUser,
} from "@/lib/dq-auth";

export async function GET(request: NextRequest) {
  if (!dqAuthEnabled()) {
    return NextResponse.json({
      authRequired: false,
      user: null,
    });
  }

  try {
    const user = await getDqUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ authRequired: true, user: null }, { status: 401 });
    }
    return NextResponse.json({
      authRequired: true,
      user: toDqSessionUser(user),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/dq_users|dq_sessions|doesn't exist/i.test(message)) {
      return NextResponse.json(
        {
          authRequired: true,
          user: null,
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
