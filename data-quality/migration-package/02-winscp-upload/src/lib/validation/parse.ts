import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedTable } from "@/lib/validation/types";

export function parseCsv(buffer: Buffer): ParsedTable {
  const text = buffer.toString("utf8");
  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length) {
    const fatal = parsed.errors.find((e) => e.type === "Quotes" || e.type === "FieldMismatch");
    if (fatal) {
      throw new Error(fatal.message || "CSV parse error");
    }
  }
  const rawRows = (parsed.data as string[][]).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (rawRows.length === 0) {
    return { headers: [], rows: [], rawRows: [] };
  }
  const headers = rawRows[0].map((h) => String(h).trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = rawRows[i][idx] != null ? String(rawRows[i][idx]).trim() : "";
    });
    rows.push(obj);
  }
  const delimGuess = guessDelimiter(text.slice(0, 4096));
  return { headers, rows, rawRows, delimiterGuess: delimGuess };
}

function guessDelimiter(sample: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const lines = sample.split(/\r?\n/).slice(0, 5);
    const counts = lines.map((l) => (l.match(new RegExp(`\\${d}`, "g")) || []).length);
    const min = Math.min(...counts);
    if (min > bestCount) {
      bestCount = min;
      best = d;
    }
  }
  return best;
}

export function parseXlsx(buffer: Buffer): ParsedTable {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { headers: [], rows: [], rawRows: [] };
  }
  const sheet = wb.Sheets[sheetName];
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  const rawRows = aoa
    .map((r) => r.map((c) => String(c ?? "").trim()))
    .filter((r) => r.some((c) => c !== ""));
  if (rawRows.length === 0) {
    return { headers: [], rows: [], rawRows: [], sheetName };
  }
  const headers = rawRows[0].map((h) => String(h).trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = rawRows[i][idx] != null ? String(rawRows[i][idx]) : "";
    });
    rows.push(obj);
  }
  return { headers, rows, rawRows, sheetName };
}

export function detectMergedHeaderLike(headers: string[]): boolean {
  const blanks = headers.filter((h) => !h || h === "__EMPTY").length;
  if (blanks > 0 && blanks < headers.length) return true;
  const dup = new Set<string>();
  for (const h of headers) {
    const k = h.toLowerCase();
    if (dup.has(k)) return true;
    dup.add(k);
  }
  return false;
}
