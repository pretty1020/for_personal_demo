import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";

export async function GET(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;
  const u = new URL(req.url);
  const qs = u.searchParams.toString();
  const res = await fetch(`${u.protocol}//${u.host}/api/dashboard${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
  const json = await res.json();
  const lines = [
    "metric,value",
    `total_files,${json.metrics?.total ?? 0}`,
    `passed,${json.metrics?.passed ?? 0}`,
    `failed,${json.metrics?.failed ?? 0}`,
    `completed_today,${json.metrics?.completedToday ?? 0}`,
  ];
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="dashboard-export.csv"',
    },
  });
}
