import * as XLSX from "xlsx";
import { parseISO, isValid } from "date-fns";
import type { FileType } from "@/lib/types/audit";
import { detectMapping } from "@/lib/columnMap";

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string | number | null>[];
  mapping: Record<string, number | null>;
}

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

export function cellNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, "").replace(/[₱$]/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86400000);
  const d = new Date(ms);
  return isValid(d) ? d : null;
}

export function parseDate(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 20000 && raw < 60000) {
      const d = excelSerialToDate(raw);
      if (d) return d.toISOString().slice(0, 10);
    }
    const d = new Date(raw);
    if (isValid(d)) return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  const tryIso = parseISO(s);
  if (isValid(tryIso)) return tryIso.toISOString().slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    const dt = new Date(y, b - 1, a);
    if (isValid(dt)) return dt.toISOString().slice(0, 10);
  }
  return null;
}

export function parseWorkbookBuffer(buffer: ArrayBuffer, fileType: FileType): ParsedTable {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    throw new Error(
      "Could not read file. Use CSV or XLSX exported from your POS or accounting tool."
    );
  }
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error("The spreadsheet has no readable sheets.");

  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as (string | number | null)[][];

  if (!matrix.length || matrix[0].length === 0) {
    throw new Error("The file appears empty.");
  }

  const rawHeader = matrix[0].map((h) => cellStr(h));
  const headers = rawHeader.map((h, i) => (h ? h : `Column_${i + 1}`));
  if (!headers.length) throw new Error("No column headers detected in the first row.");

  const mapping = detectMapping(headers, fileType);

  const rows: Record<string, string | number | null>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || line.every((c) => c === null || c === "" || c === undefined)) continue;
    const obj: Record<string, string | number | null> = {};
    headers.forEach((h, i) => {
      const v = line[i];
      obj[h] = typeof v === "number" ? v : cellStr(v) || null;
    });
    rows.push(obj);
  }

  return { headers, rows, mapping };
}

export function col(
  row: Record<string, string | number | null>,
  headers: string[],
  idx: number | null
): string | number | null {
  if (idx === null) return null;
  const key = headers[idx];
  return key ? row[key] ?? null : null;
}
