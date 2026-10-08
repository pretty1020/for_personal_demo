import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { usesJson } from "@/lib/db";
import { mariadbGetFileErrorsForExport } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";
import type { FileErrorRow } from "@/types/database";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (usesJson()) {
    const errors = await readStandalone((s) => {
      const file = s.files.find((f) => f.id === id);
      if (!file) return { err: "not_found" as const, rows: [] };
      const runId = (file.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
      if (!runId) return { err: "no_run" as const, rows: [] };
      const rows = s.file_errors
        .filter((e) => e.validation_run_id === runId && e.row_index != null)
        .sort((a, b) => (a.row_index ?? 0) - (b.row_index ?? 0));
      return { err: "ok" as const, rows };
    });
    if (errors.err === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (errors.err === "no_run") return NextResponse.json({ error: "No validation run" }, { status: 400 });
    if (errors.err !== "ok") return NextResponse.json({ error: "Unexpected" }, { status: 500 });
    const lines = ["row_index,code,severity,message,column"];
    for (const e of errors.rows) {
      lines.push(
        [e.row_index, e.code, e.severity, JSON.stringify(e.message), e.column_name ?? ""].join(","),
      );
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="failed-rows-${id}.csv"`,
      },
    });
  }

  const result = await mariadbGetFileErrorsForExport(id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const runId = (result.file.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
  if (!runId) return NextResponse.json({ error: "No validation run" }, { status: 400 });

  const rows = (result.errors as FileErrorRow[]).filter((e) => e.row_index != null);
  const lines = ["row_index,code,severity,message,column"];
  for (const e of rows) {
    lines.push(
      [e.row_index, e.code, e.severity, JSON.stringify(e.message), e.column_name ?? ""].join(","),
    );
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="failed-rows-${id}.csv"`,
    },
  });
}
