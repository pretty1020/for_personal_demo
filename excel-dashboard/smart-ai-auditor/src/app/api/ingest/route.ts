import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseWorkbookBuffer } from "@/lib/parseUpload";
import {
  assertRequiredColumns,
  rowsForExpense,
  rowsForInventory,
  rowsForSales,
  rowsForStaff,
} from "@/lib/ingestNormalize";
import type { FileType } from "@/lib/types/audit";

const schema = z.object({ uploadId: z.string().uuid() });

type UploadRow = {
  id: string;
  business_id: string;
  user_id: string;
  file_type: string;
  storage_path: string;
  status: string;
};

async function verifyUpload(
  userId: string,
  uploadId: string
): Promise<
  | { ok: true; upload: UploadRow }
  | { ok: false; status: number; msg: string }
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("uploads")
    .select("id, business_id, user_id, file_type, storage_path, status")
    .eq("id", uploadId)
    .maybeSingle();
  if (error || !data) return { ok: false, status: 404, msg: "Upload not found" };
  if (data.user_id !== userId) return { ok: false, status: 403, msg: "Forbidden" };
  return { ok: true, upload: data as UploadRow };
}

async function clearType(admin: ReturnType<typeof createAdminClient>, businessId: string, type: FileType) {
  const table =
    type === "sales"
      ? "sales_data"
      : type === "inventory"
        ? "inventory_data"
        : type === "expense"
          ? "expense_data"
          : "staff_data";
  await admin.from(table).delete().eq("business_id", businessId);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const check = await verifyUpload(user.id, parsed.data.uploadId);
  if (!check.ok) return NextResponse.json({ error: check.msg }, { status: check.status });
  const uploadRow = check.upload;

  const admin = createAdminClient();
  await admin
    .from("uploads")
    .update({ status: "processing", error_message: null })
    .eq("id", uploadRow.id);

  try {
    const dl = await admin.storage.from("reports").download(uploadRow.storage_path);
    if (dl.error || !dl.data) throw new Error(dl.error?.message || "Could not download file from storage.");

    const buf = await dl.data.arrayBuffer();
    const fileType = uploadRow.file_type as FileType;
    const parsedTable = parseWorkbookBuffer(buf, fileType);
    assertRequiredColumns(fileType, parsedTable.mapping);

    const businessId = uploadRow.business_id;
    const uploadId = uploadRow.id;

    await clearType(admin, businessId, fileType);

    const chunk = 400;
    if (fileType === "sales") {
      const rows = rowsForSales(parsedTable, businessId, uploadId);
      for (let i = 0; i < rows.length; i += chunk) {
        const { error } = await admin.from("sales_data").insert(rows.slice(i, i + chunk));
        if (error) throw new Error(error.message);
      }
      await admin
        .from("uploads")
        .update({ status: "complete", row_count: rows.length })
        .eq("id", uploadId);
    } else if (fileType === "inventory") {
      const rows = rowsForInventory(parsedTable, businessId, uploadId);
      for (let i = 0; i < rows.length; i += chunk) {
        const { error } = await admin.from("inventory_data").insert(rows.slice(i, i + chunk));
        if (error) throw new Error(error.message);
      }
      await admin
        .from("uploads")
        .update({ status: "complete", row_count: rows.length })
        .eq("id", uploadId);
    } else if (fileType === "expense") {
      const rows = rowsForExpense(parsedTable, businessId, uploadId);
      for (let i = 0; i < rows.length; i += chunk) {
        const { error } = await admin.from("expense_data").insert(rows.slice(i, i + chunk));
        if (error) throw new Error(error.message);
      }
      await admin
        .from("uploads")
        .update({ status: "complete", row_count: rows.length })
        .eq("id", uploadId);
    } else {
      const rows = rowsForStaff(parsedTable, businessId, uploadId);
      for (let i = 0; i < rows.length; i += chunk) {
        const { error } = await admin.from("staff_data").insert(rows.slice(i, i + chunk));
        if (error) throw new Error(error.message);
      }
      await admin
        .from("uploads")
        .update({ status: "complete", row_count: rows.length })
        .eq("id", uploadId);
    }

    return NextResponse.json({ ok: true, rows: parsedTable.rows.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ingest failed";
    await admin
      .from("uploads")
      .update({ status: "error", error_message: msg })
      .eq("id", uploadRow.id);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
