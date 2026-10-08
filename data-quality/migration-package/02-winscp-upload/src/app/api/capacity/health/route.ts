import { NextResponse } from "next/server";
import { mariadbReady, pingMariaDb } from "@capacity-api/db";

export async function GET() {
  let database: "missing_config" | "connected" | "error" = "missing_config";

  if (mariadbReady()) {
    database = (await pingMariaDb()) ? "connected" : "error";
  }

  return NextResponse.json({
    ok: database === "connected",
    database,
    auth: database === "connected" ? "database" : "demo",
  });
}
