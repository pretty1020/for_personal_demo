import type { ColumnDataType } from "@/types/database";

export type UploadFrequency = "daily" | "weekly" | "monthly";

export type WorkflowPassRules = {
  min_rows?: number;
  file_name_pattern?: string;
  client_name?: string;
  upload_frequency?: UploadFrequency;
  allow_duplicates?: boolean;
  data_owners?: string[];
  [key: string]: unknown;
};

export function asPassRules(raw: Record<string, unknown> | null | undefined): WorkflowPassRules {
  return (raw || {}) as WorkflowPassRules;
}

export function getUploadFrequency(passRules: Record<string, unknown> | null | undefined): UploadFrequency {
  const v = asPassRules(passRules).upload_frequency;
  if (v === "weekly" || v === "monthly" || v === "daily") return v;
  return "daily";
}

export function getAllowDuplicates(passRules: Record<string, unknown> | null | undefined): boolean {
  return Boolean(asPassRules(passRules).allow_duplicates);
}

export function getDataOwners(passRules: Record<string, unknown> | null | undefined): string[] {
  const raw = asPassRules(passRules).data_owners;
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => String(o).trim()).filter(Boolean);
}

export function mergeWorkflowMetaIntoPassRules(
  passRules: Record<string, unknown>,
  meta: {
    client_name?: string | null;
    upload_frequency?: UploadFrequency | null;
    allow_duplicates?: boolean | null;
    data_owners?: string[] | null;
    file_name_pattern?: string | null;
    min_rows?: number | null;
  },
): WorkflowPassRules {
  const next: WorkflowPassRules = { ...asPassRules(passRules) };

  if (meta.client_name !== undefined) {
    const t = meta.client_name?.trim() || "";
    if (t) next.client_name = t;
    else delete next.client_name;
  }
  if (meta.upload_frequency) next.upload_frequency = meta.upload_frequency;
  if (meta.allow_duplicates !== undefined && meta.allow_duplicates !== null) {
    next.allow_duplicates = Boolean(meta.allow_duplicates);
  }
  if (meta.data_owners !== undefined) {
    const owners = (meta.data_owners || []).map((o) => o.trim()).filter(Boolean);
    if (owners.length) next.data_owners = owners;
    else delete next.data_owners;
  }
  if (meta.file_name_pattern !== undefined) {
    const p = meta.file_name_pattern?.trim() || "";
    if (p) next.file_name_pattern = p;
    else delete next.file_name_pattern;
  }
  if (meta.min_rows != null && Number.isFinite(meta.min_rows)) {
    next.min_rows = Math.max(1, Number(meta.min_rows));
  }
  return next;
}

const DATE_RE =
  /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{2}-\d{2}-\d{4}$/;

export function inferColumnDataType(samples: string[]): ColumnDataType {
  const values = samples.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (!values.length) return "string";

  let dateHits = 0;
  let numberHits = 0;
  for (const v of values) {
    if (DATE_RE.test(v) && !Number.isNaN(new Date(v).getTime())) dateHits += 1;
    else if (!Number.isNaN(Number(String(v).replace(/,/g, "")))) numberHits += 1;
  }
  const n = values.length;
  if (dateHits / n >= 0.8) return "date";
  if (numberHits / n >= 0.8) return "number";

  const unique = new Set(values.map((v) => v.toLowerCase()));
  if (unique.size > 0 && unique.size <= Math.min(12, Math.ceil(n * 0.35)) && n >= 4) {
    return "category";
  }
  return "string";
}

export function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Suggest a filename pattern from an uploaded sample name (exact match by default). */
export function suggestFileNamePattern(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return "";
  return `^${escapeRegexLiteral(trimmed)}$`;
}
