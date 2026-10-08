/** Extract and validate YYYYMMDD period tokens from upload filenames. */

const YMD_RE = /(\d{8})/g;

export function isValidYyyymmdd(token: string): boolean {
  if (!/^\d{8}$/.test(token)) return false;
  const y = Number(token.slice(0, 4));
  const m = Number(token.slice(4, 6));
  const d = Number(token.slice(6, 8));
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

/** First valid YYYYMMDD found in the filename (basename). */
export function extractYyyymmddFromFileName(fileName: string): string | null {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  const matches = base.match(YMD_RE) || [];
  for (const m of matches) {
    if (isValidYyyymmdd(m)) return m;
  }
  return null;
}

export function yyyymmddToDate(token: string): Date | null {
  if (!isValidYyyymmdd(token)) return null;
  const y = Number(token.slice(0, 4));
  const m = Number(token.slice(4, 6));
  const d = Number(token.slice(6, 8));
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function formatYyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function requireYyyymmddInFileName(fileName: string):
  | { ok: true; period: string }
  | { ok: false; error: string } {
  const period = extractYyyymmddFromFileName(fileName);
  if (!period) {
    return {
      ok: false,
      error:
        "Filename must include a valid date as YYYYMMDD (e.g. Client_Orders_20260324.csv).",
    };
  }
  return { ok: true, period };
}

/** Suggest a pattern that keeps a dynamic YYYYMMDD slot. */
export function suggestDynamicYyyymmddPattern(fileName: string): string {
  const base = (fileName.split(/[/\\]/).pop() || fileName).trim();
  if (!base) return String.raw`.*\d{8}.*`;
  const period = extractYyyymmddFromFileName(base);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (period) {
    return `^${escaped.replace(period, String.raw`\d{8}`)}$`;
  }
  const dot = escaped.lastIndexOf("\\.");
  if (dot > 0) {
    return `^${escaped.slice(0, dot)}_\\d{8}${escaped.slice(dot)}$`;
  }
  return `^${escaped}_\\d{8}$`;
}
