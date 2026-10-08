import * as XLSX from "xlsx";
import { parseCsv, parseXlsx } from "@/lib/validation/parse";

export type MergeResult =
  | { ok: true; buffer: Buffer; rowCount: number }
  | { ok: false; error: string };

function rowsToCsv(headers: string[], rows: Record<string, string>[]): Buffer {
  const escape = (v: string) => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(String(row[h] ?? ""))).join(","));
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function rowsToXlsx(headers: string[], rows: Record<string, string>[]): Buffer {
  const aoa = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}

/** Append/merge new file rows onto an existing file (same headers required). */
export function mergeTabularBuffers(input: {
  existingName: string;
  existingBuffer: Buffer;
  incomingName: string;
  incomingBuffer: Buffer;
  expectedFileType: "csv" | "xlsx";
}): MergeResult {
  const parse = (name: string, buf: Buffer) => {
    const lower = name.toLowerCase();
    if (input.expectedFileType === "csv" || lower.endsWith(".csv")) return parseCsv(buf);
    return parseXlsx(buf);
  };

  let existing;
  let incoming;
  try {
    existing = parse(input.existingName, input.existingBuffer);
    incoming = parse(input.incomingName, input.incomingBuffer);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to parse files for merge" };
  }

  const h1 = existing.headers.map((h) => h.trim()).filter(Boolean);
  const h2 = incoming.headers.map((h) => h.trim()).filter(Boolean);
  if (!h1.length || !h2.length) {
    return { ok: false, error: "Cannot merge: missing header row." };
  }
  if (h1.length !== h2.length || h1.some((h, i) => h.toLowerCase() !== h2[i].toLowerCase())) {
    return {
      ok: false,
      error: `Cannot merge: column headers do not match.\nExisting: ${h1.join(", ")}\nIncoming: ${h2.join(", ")}`,
    };
  }

  const mergedRows = [...existing.rows, ...incoming.rows];
  const buffer =
    input.expectedFileType === "csv"
      ? rowsToCsv(h1, mergedRows)
      : rowsToXlsx(h1, mergedRows);

  return { ok: true, buffer, rowCount: mergedRows.length };
}
