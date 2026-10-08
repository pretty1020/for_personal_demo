import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { usesJson } from "@/lib/db";
import { mariadbGetFile } from "@/lib/mariadb/repository";
import { readStandalone } from "@/lib/standalone/store";
import { readFileBytes } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireDqAuth(request);
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  if (usesJson()) {
    const file = await readStandalone((s) => s.files.find((f) => f.id === id) ?? null);
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (file.status !== "processed") {
      return NextResponse.json({ error: "File is not processed yet" }, { status: 400 });
    }
    const meta = (file.metadata || {}) as { processed_path?: string };
    if (!meta.processed_path) {
      return NextResponse.json({ error: "Processed path missing" }, { status: 404 });
    }
    const buf = await readFileBytes(meta.processed_path).catch(() => null);
    if (!buf) return NextResponse.json({ error: "Unable to read processed file" }, { status: 500 });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": file.mime_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.original_name}"`,
      },
    });
  }
  const file = await mariadbGetFile(id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (file.status !== "processed") {
    return NextResponse.json({ error: "File is not processed yet" }, { status: 400 });
  }
  const meta = (file.metadata || {}) as { processed_path?: string };
  if (!meta.processed_path) {
    return NextResponse.json({ error: "Processed path missing" }, { status: 404 });
  }
  const buf = await readFileBytes(meta.processed_path).catch(() => null);
  if (!buf) return NextResponse.json({ error: "Unable to read processed file" }, { status: 500 });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.original_name}"`,
    },
  });
}
