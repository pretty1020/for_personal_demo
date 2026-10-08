import path from "node:path";
import { parseCsv, parseXlsx } from "@/lib/validation/parse";
import {
  inferColumnDataType,
  suggestFileNamePattern,
} from "@/lib/workflow-meta";
import type { ColumnDataType } from "@/types/database";

export type InspectedColumn = {
  column_name: string;
  data_type: ColumnDataType;
  is_required: boolean;
  sample_values: string[];
};

export type InspectFileResult = {
  fileName: string;
  suggestedFileNamePattern: string;
  expectedFileType: "csv" | "xlsx";
  headers: string[];
  columns: InspectedColumn[];
  rowCount: number;
};

export function inspectUploadedBuffer(fileName: string, buffer: Buffer): InspectFileResult {
  const ext = path.extname(fileName).toLowerCase();
  const expectedFileType: "csv" | "xlsx" = ext === ".xlsx" || ext === ".xls" ? "xlsx" : "csv";
  const table = expectedFileType === "csv" ? parseCsv(buffer) : parseXlsx(buffer);
  const headers = table.headers.map((h) => h.trim()).filter(Boolean);

  const columns: InspectedColumn[] = headers.map((column_name) => {
    const samples = table.rows.slice(0, 40).map((r) => String(r[column_name] ?? ""));
    return {
      column_name,
      data_type: inferColumnDataType(samples),
      is_required: true,
      sample_values: samples.filter(Boolean).slice(0, 5),
    };
  });

  return {
    fileName,
    suggestedFileNamePattern: suggestFileNamePattern(fileName),
    expectedFileType,
    headers,
    columns,
    rowCount: table.rows.length,
  };
}
