import { NextResponse } from "next/server";
import { requireDqAuth } from "@/lib/api-guard";
import { inspectUploadedBuffer } from "@/lib/validation/inspect-file";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

/** Inspect a sample file to auto-fill filename pattern + columns when creating a workflow. */
export async function POST(req: Request) {
  const auth = await requireDqAuth(req);
  if ("error" in auth) return auth.error;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 4 MB inspect limit" }, { status: 413 });
    }
    const result = inspectUploadedBuffer(file.name, buffer);
    if (!result.columns.length) {
      return NextResponse.json(
        { error: "Could not detect columns. Check that the file has a header row." },
        { status: 400 },
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Inspect failed";
    console.error("[api/workflows/inspect]", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
