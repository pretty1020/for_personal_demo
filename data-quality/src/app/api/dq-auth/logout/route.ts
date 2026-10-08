import { NextResponse, type NextRequest } from "next/server";
import {
  clearDqSessionCookie,
  deleteDqSession,
  readDqSessionToken,
} from "@/lib/dq-auth";

export async function POST(request: NextRequest) {
  const token = readDqSessionToken(request);
  if (token) {
    try {
      await deleteDqSession(token);
    } catch {
      // Ignore missing tables on logout.
    }
  }
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearDqSessionCookie());
  return response;
}
