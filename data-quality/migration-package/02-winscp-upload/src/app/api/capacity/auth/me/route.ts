import { NextResponse, type NextRequest } from "next/server";
import { mariadbReady } from "@capacity-api/db";
import {
  getCapacityUserFromSession,
  readCapacitySessionToken,
  toCapacitySessionUser,
} from "@/lib/capacity-api/session";

export async function GET(request: NextRequest) {
  if (!mariadbReady()) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const token = readCapacitySessionToken(request);
  if (!token) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const user = await getCapacityUserFromSession(token);
  if (!user) {
    return NextResponse.json({ error: "Session expired or invalid." }, { status: 401 });
  }

  return NextResponse.json({ user: toCapacitySessionUser(user) });
}
