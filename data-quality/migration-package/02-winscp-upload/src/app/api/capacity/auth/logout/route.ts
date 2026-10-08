import { NextResponse, type NextRequest } from "next/server";
import {
  clearSessionCookie,
  deleteCapacitySession,
  readCapacitySessionToken,
} from "@/lib/capacity-api/session";

export async function POST(request: NextRequest) {
  const token = readCapacitySessionToken(request);
  if (token) {
    try {
      await deleteCapacitySession(token);
    } catch (error) {
      console.error("Capacity logout failed:", error);
    }
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
}
