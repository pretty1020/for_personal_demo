import { NextResponse } from "next/server";
import { requireBackend } from "@/lib/api-guard";
import { usesJson } from "@/lib/db";
import { mariadbGetFileDetailPayload } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireBackend();
  if (blocked) return blocked;
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "json";
  if (usesJson()) {
    const payload = await readStandalone((s) => {
      const file = s.files.find((f) => f.id === id);
      if (!file) return null;
      const runId = (file.metadata as { last_validation_run_id?: string })?.last_validation_run_id;
      const run = runId ? (s.validation_runs.find((r) => r.id === runId) ?? null) : null;
      const errors = run?.id ? s.file_errors.filter((e) => e.validation_run_id === run.id) : [];
      return {
        file: { id: file.id, name: file.original_name, status: file.status },
        validationRun: run,
        errors,
        exportedAt: new Date().toISOString(),
      };
    });
    if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (format === "csv") {
      const lines = [
        "type,code,message,row,column",
        ...payload.errors.map(
          (e: { severity: string; code: string; message: string; row_index: number | null; column_name: string | null }) =>
            [
              e.severity,
              e.code,
              JSON.stringify(e.message),
              e.row_index ?? "",
              e.column_name ?? "",
            ].join(","),
        ),
      ];
      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="validation-${id}.csv"`,
        },
      });
    }
    return NextResponse.json(payload);
  }

  const detail = await mariadbGetFileDetailPayload(id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = {
    file: { id: detail.file.id, name: detail.file.original_name, status: detail.file.status },
    validationRun: detail.validationRun,
    errors: detail.errors,
    exportedAt: new Date().toISOString(),
  };

  if (format === "csv") {
    const lines = [
      "type,code,message,row,column",
      ...detail.errors.map((e) =>
        [e.severity, e.code, JSON.stringify(e.message), e.row_index ?? "", e.column_name ?? ""].join(","),
      ),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="validation-${id}.csv"`,
      },
    });
  }

  return NextResponse.json(payload);
}
