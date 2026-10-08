import path from "node:path";

const UNSAFE_CHARS = /[<>:"|?*\x00-\x1f]/;
const MAX_NAME_LENGTH = 255;

export type UploadGuardResult = { ok: true } | { ok: false; error: string };

export function validateUploadFileName(
  fileName: string,
  expectedFileType: "csv" | "xlsx",
  fileNamePattern?: string | null,
): UploadGuardResult {
  const trimmed = fileName.trim();
  if (!trimmed) return { ok: false, error: "File name is required." };
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `File name exceeds ${MAX_NAME_LENGTH} characters.` };
  }
  if (UNSAFE_CHARS.test(trimmed) || trimmed.includes("..")) {
    return { ok: false, error: "File name contains invalid characters." };
  }

  const ext = path.extname(trimmed).toLowerCase();
  if (expectedFileType === "csv") {
    if (ext !== ".csv") {
      return { ok: false, error: "This workflow accepts CSV files only (.csv)." };
    }
  } else if (![".xlsx", ".xls"].includes(ext)) {
    return { ok: false, error: "This workflow accepts Excel files only (.xlsx or .xls)." };
  }

  if (fileNamePattern) {
    try {
      const re = new RegExp(fileNamePattern);
      if (!re.test(trimmed)) {
        return {
          ok: false,
          error: `File name does not match the required pattern: ${fileNamePattern}`,
        };
      }
    } catch {
      return { ok: false, error: "Workflow file name pattern is invalid. Contact an administrator." };
    }
  }

  return { ok: true };
}

export function validateUploadMimeType(
  mimeType: string | null,
  expectedFileType: "csv" | "xlsx",
): UploadGuardResult {
  if (!mimeType || mimeType === "application/octet-stream") return { ok: true };

  if (expectedFileType === "csv") {
    if (!mimeType.includes("csv") && !mimeType.includes("text")) {
      return { ok: false, error: "Uploaded file does not appear to be a CSV." };
    }
    return { ok: true };
  }

  if (
    !mimeType.includes("spreadsheet") &&
    !mimeType.includes("excel") &&
    mimeType !== "application/vnd.ms-excel"
  ) {
    return { ok: false, error: "Uploaded file does not appear to be an Excel spreadsheet." };
  }

  return { ok: true };
}
