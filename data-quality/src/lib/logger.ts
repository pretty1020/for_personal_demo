/** Server-side logging without exposing secrets. */

const SENSITIVE = /password|secret|token|key|authorization/i;

function safeMeta(meta?: Record<string, unknown>) {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  }
  return out;
}

export function logError(scope: string, error: unknown, meta?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  if (process.env.NODE_ENV === "production") {
    console.error(`[${scope}]`, message, safeMeta(meta));
  } else {
    console.error(`[${scope}]`, error, safeMeta(meta));
  }
}

export function logInfo(scope: string, message: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[${scope}]`, message, safeMeta(meta));
  }
}
